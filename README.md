# TaskFlow Pro

A Kanban board (Backlog → In Progress → Review → Done) backed by a DAG
(Directed Acyclic Graph) dependency engine. The board is the UI; the graph
is the source of truth for whether a task is **Blocked** or **Ready**, and
for how schedule changes ripple downstream.

## Stack

| Layer    | Choice                                            |
|----------|----------------------------------------------------|
| Frontend | React + Vite, `@hello-pangea/dnd` for drag-and-drop |
| Backend  | Node.js + Express                                  |
| Storage  | SQLite via Sequelize (swap to Postgres by changing `backend/db.js`) |
| AI       | Claude (Anthropic Messages API) for dependency suggestions |

## Project structure

```
taskflow-pro/
  backend/
    dag.js          ← the whole dependency engine (cycle check, status,
                       schedule propagation, critical path) — pure functions,
                       no Express/DB code, so it's easy to reason about
                       and easy to unit test
    dag.test.js      12 unit tests for dag.js (cycles, blocked/ready,
                       no-compounding propagation, critical path)
    middleware/
      asyncHandler.js  wraps async routes so thrown errors reach errorHandler
                        instead of crashing the process
      errorHandler.js  centralized error responses + 404 handler
    models/          Sequelize models (Task, Dependency)
    routes/
      tasks.js       CRUD + dependency endpoints
      ai.js          AI dependency-suggestion endpoint
    server.js
    seed.js          Inserts 9 seeded tasks with a realistic dependency graph
  .github/workflows/ci.yml   runs the backend test suite on every push/PR
  frontend/
    src/
      App.jsx         board state, drag-and-drop, critical path toggle
      components/
        Column.jsx
        TaskCard.jsx
        TaskModal.jsx  create/edit task, dependency picker, AI suggestions
      api.js
```

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# open .env and paste your Anthropic API key (only needed for AI suggestions —
# everything else works without it)
npm run seed     # creates taskflow.sqlite and inserts 9 seeded tasks
npm start        # runs on http://localhost:4000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev      # runs on http://localhost:5173, proxies /api to :4000
```

Open http://localhost:5173.

## Testing

```bash
cd backend
npm test
```

Runs 12 unit tests against `dag.js` using Node's built-in test runner (no
extra dependencies). Coverage focuses on the constraints called out in the
problem statement specifically:

- Cycle rejection — direct (`A→B→A`), transitive (`A→B→C→A`), and self-dependency
- A valid new edge in an unrelated part of the graph, and a valid convergence edge, are both correctly **allowed** (so cycle detection isn't just rejecting everything)
- Blocked → Ready transition once all prerequisites are `done`
- Rollback on regression — moving a task out of `done` re-blocks its dependents
- **No-compounding propagation** on a diamond graph (`A→B→D`, `A→C→D`): asserts D shifts by the actual impact once, and explicitly asserts it does *not* equal what a naive sum-of-deltas implementation would produce
- Critical path picks the longest cumulative-duration chain, not just the longest hop count

`.github/workflows/ci.yml` runs this same suite automatically on every push
and pull request.

## Error handling & security

- Every async route is wrapped in `asyncHandler` and funnels into one
  `errorHandler` middleware, so failures return a consistent JSON error
  shape instead of an unhandled rejection crashing the server or a raw
  stack trace leaking to the client.
- `helmet` sets standard security headers (CSP, X-Frame-Options, etc.).
- `express-rate-limit` caps requests per IP, primarily to bound calls to the
  paid AI endpoint.
- No secrets are ever sent to the frontend — the Anthropic API key is read
  from `backend/.env` (gitignored) and used only in server-side code.

## How the DAG engine works (`backend/dag.js`)

### Blocked vs Ready
Computed fresh on every `GET /api/tasks` — never stored. A task is
**Blocked** if *any* of its prerequisites is not `done`; otherwise **Ready**.
Because it's recalculated from current task statuses every time, moving a
task backward (Rollback on Regression) automatically re-blocks its
dependents — there's no separate "unblock/reblock" code path to keep in
sync.

### No cycles
Before any dependency edge is persisted, `wouldCreateCycle()` simulates
adding it and runs a full topological sort (Kahn's algorithm) over the
resulting graph. If not every node can be ordered, a cycle exists, the
request is rejected with `409` and a clear message, and nothing is written.

### No compounding (schedule propagation)
This is the part of the spec worth explaining directly. Instead of tracking
a "delta" (e.g. "+3 days") and adding it once per incoming dependency edge —
which is exactly what causes double-counting at a convergence point — we
**recompute absolute dates** for every task in topological order:

```
task.startDate = max(endDate of all its prerequisites) + 1 day
task.endDate   = task.startDate + task.duration
```

Because this is a `max` over converging paths rather than a sum, a task with
two upstream paths that both trace back to the same delayed task only ever
reflects that delay once — regardless of how many paths connect them. This
naturally satisfies the "Task D should move by 3 days, not 6 days" example
in the spec without any special-cased path-deduplication logic.

### Critical path
Standard longest-path-in-a-DAG via dynamic programming over the topological
order, using each task's `duration` as edge weight. Toggled from the "Show
Critical Path" button in the UI, which highlights the returned task ids.

## AI-Tool Declaration

**Feature:** "✨ Suggest with AI" button in the task creation/edit modal
(`backend/routes/ai.js`, `frontend/src/components/TaskModal.jsx`).

**What it does:** given a new task's title + description, it asks Claude
(`claude-sonnet-4-6` via the Messages API) which of the *existing* tasks in
the project are plausible prerequisites, with a confidence score and a
one-line reason for each.

**Grounding techniques used to reduce hallucination:**
1. The prompt includes the **complete, closed list** of existing task ids +
   titles + descriptions and explicitly instructs the model to only choose
   from that list — it has no way to reference a task that doesn't exist.
2. The model is forced to answer in **strict JSON** (`id`, `confidence`,
   `reasoning`), which is parsed server-side rather than trusting free text.
3. **Server-side re-validation**: after parsing, every suggested `id` is
   checked against the real, current task list. Anything that doesn't match
   (a hallucinated id, or one from a stale response) is silently dropped
   before it ever reaches the client.
4. **Human validation stays in the loop by construction**: the AI endpoint
   never writes to the `dependencies` table. Suggestions are purely
   advisory — the user must click "Accept" on each one individually in the
   UI, which then goes through the exact same `POST
   /api/tasks/:id/dependencies` endpoint (and the same cycle-check) as a
   manually added dependency. There is no code path where an AI suggestion
   becomes a real edge without an explicit user action.

**AI use during development:** Claude (Anthropic) was used as a coding
assistant to scaffold and write this project — backend routes, the DAG
algorithms, the frontend, and this README were all authored with Claude's
help and then reviewed and manually tested end-to-end (seeded data, cycle
rejection, and the no-compounding propagation case were each verified
against expected output before submission, and the full backend test suite
above must pass). Disclosed here per the hackathon's AI-tool requirement.

## Key Assumptions & Limitations

- **Single-user, no auth.** There's no login/session model — anyone with
  the URL can edit the board. Fine for a hackathon demo, not production.
- **SQLite for local persistence.** Chosen for zero-setup review; the
  Sequelize layer makes swapping to Postgres a config change in
  `backend/db.js`, not a rewrite.
- **Duration is fixed once a task is created; only `startDate` moves during
  propagation.** If a task's *duration* itself changes later, propagation
  still runs and downstream tasks recompute correctly, but we don't
  currently distinguish "the task got delayed" from "the task got longer"
  in the UI — both just show up as a date change.
- **"Business days" are not modeled.** Propagation uses calendar days
  (Saturdays/Sundays count), since the spec didn't require a working-day
  calendar.
- **AI suggestions require `ANTHROPIC_API_KEY`.** Without it, the rest of
  the app (board, drag-and-drop, manual dependencies, cycle detection,
  propagation, critical path) works fully — only the "Suggest with AI"
  button will show a clear error instead of results.
- **Position ordering on drop is index-based, not renumbered globally.** For
  a board of this size that's sufficient, but a very large board would
  benefit from periodic position renumbering to avoid float/collision edge
  cases.
- **Optimistic drag-and-drop UI**: a failed `PUT` (e.g. network blip) rolls
  the card back visually, but there's no retry queue — the user would need
  to drag again.
