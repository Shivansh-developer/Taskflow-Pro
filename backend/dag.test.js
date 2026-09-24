/**
 * dag.test.js — unit tests for the dependency engine.
 * Run with: npm test  (uses Node's built-in test runner, no extra deps)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  wouldCreateCycle,
  computeDependencyStates,
  recomputeSchedule,
  criticalPath,
} = require("./dag");

test("wouldCreateCycle: rejects a direct cycle (A -> B -> A)", () => {
  const deps = [{ taskId: "B", prerequisiteId: "A" }]; // A -> B
  // Now try to add B -> A, which would close the loop
  assert.equal(wouldCreateCycle(deps, "A", "B"), true);
});

test("wouldCreateCycle: rejects a longer cycle (A -> B -> C -> A)", () => {
  const deps = [
    { taskId: "B", prerequisiteId: "A" }, // A -> B
    { taskId: "C", prerequisiteId: "B" }, // B -> C
  ];
  // Adding C -> A closes A -> B -> C -> A
  assert.equal(wouldCreateCycle(deps, "A", "C"), true);
});

test("wouldCreateCycle: rejects a task depending on itself", () => {
  assert.equal(wouldCreateCycle([], "A", "A"), true);
});

test("wouldCreateCycle: allows a valid new edge in an unrelated part of the graph", () => {
  const deps = [{ taskId: "B", prerequisiteId: "A" }]; // A -> B
  // C depends on D — totally unrelated to A/B, must be allowed
  assert.equal(wouldCreateCycle(deps, "D", "C"), false);
});

test("wouldCreateCycle: allows a valid diamond edge (A->B->D and A->C->D is fine)", () => {
  const deps = [
    { taskId: "B", prerequisiteId: "A" },
    { taskId: "C", prerequisiteId: "A" },
    { taskId: "D", prerequisiteId: "B" },
  ];
  // Adding D -> C (C depends on D too) is a valid convergence, not a cycle
  assert.equal(wouldCreateCycle(deps, "C", "D"), false);
});

test("computeDependencyStates: task with an unfinished prerequisite is Blocked", () => {
  const tasks = [
    { id: "A", status: "in_progress" },
    { id: "B", status: "backlog" },
  ];
  const deps = [{ taskId: "B", prerequisiteId: "A" }];
  const states = computeDependencyStates(tasks, deps);
  assert.equal(states.get("B").blocked, true);
  assert.equal(states.get("B").ready, false);
});

test("computeDependencyStates: task becomes Ready once all prerequisites are done", () => {
  const tasks = [
    { id: "A", status: "done" },
    { id: "B", status: "backlog" },
  ];
  const deps = [{ taskId: "B", prerequisiteId: "A" }];
  const states = computeDependencyStates(tasks, deps);
  assert.equal(states.get("B").blocked, false);
  assert.equal(states.get("B").ready, true);
});

test("computeDependencyStates: rollback re-blocks downstream when upstream moves out of done", () => {
  const tasks = [
    { id: "A", status: "in_progress" }, // was "done", moved back
    { id: "B", status: "in_progress" },
  ];
  const deps = [{ taskId: "B", prerequisiteId: "A" }];
  const states = computeDependencyStates(tasks, deps);
  assert.equal(states.get("B").blocked, true);
});

test("computeDependencyStates: task with no prerequisites is always Ready", () => {
  const tasks = [{ id: "A", status: "backlog" }];
  const states = computeDependencyStates(tasks, []);
  assert.equal(states.get("A").ready, true);
});

test("recomputeSchedule: diamond convergence does NOT double-count the delay", () => {
  // A (+duration) feeds both B and C, which both feed D.
  // If A's schedule shifts, D must move by the actual impact, once — not
  // once per incoming path.
  const tasks = [
    { id: "A", startDate: "2026-01-01", endDate: "2026-01-08", duration: 7 }, // extended task
    { id: "B", startDate: "2026-01-02", endDate: "2026-01-04", duration: 2 },
    { id: "C", startDate: "2026-01-02", endDate: "2026-01-03", duration: 1 },
    { id: "D", startDate: "2026-01-05", endDate: "2026-01-06", duration: 1 },
  ];
  const deps = [
    { taskId: "B", prerequisiteId: "A" },
    { taskId: "C", prerequisiteId: "A" },
    { taskId: "D", prerequisiteId: "B" },
    { taskId: "D", prerequisiteId: "C" },
  ];
  const result = recomputeSchedule(tasks, deps);

  const bEnd = result.get("B").endDate;
  const cEnd = result.get("C").endDate;
  const dStart = result.get("D").startDate;

  // D must start the day after the LATER of B/C — i.e. max(), not sum()
  const expectedDStart = new Date(bEnd > cEnd ? bEnd : cEnd);
  expectedDStart.setDate(expectedDStart.getDate() + 1);
  assert.equal(dStart, expectedDStart.toISOString().slice(0, 10));

  // Sanity: D's start is NOT later than max(B.end, C.end) + 1 day, which is
  // what a (buggy) sum-of-deltas implementation would produce instead.
  const naiveSumStart = new Date("2026-01-01");
  naiveSumStart.setDate(naiveSumStart.getDate() + 7 + 7); // double-counted, wrong
  assert.notEqual(dStart, naiveSumStart.toISOString().slice(0, 10));
});

test("recomputeSchedule: a task with no prerequisites keeps its own dates", () => {
  const tasks = [{ id: "A", startDate: "2026-02-01", endDate: "2026-02-05", duration: 4 }];
  const result = recomputeSchedule(tasks, []);
  assert.equal(result.get("A").startDate, "2026-02-01");
  assert.equal(result.get("A").changed, false);
});

test("criticalPath: picks the longest chain by cumulative duration", () => {
  // Chain 1: A(3) -> B(2) -> C(1) = 6
  // Chain 2: X(1) -> Y(1) = 2
  const tasks = [
    { id: "A", duration: 3 },
    { id: "B", duration: 2 },
    { id: "C", duration: 1 },
    { id: "X", duration: 1 },
    { id: "Y", duration: 1 },
  ];
  const deps = [
    { taskId: "B", prerequisiteId: "A" },
    { taskId: "C", prerequisiteId: "B" },
    { taskId: "Y", prerequisiteId: "X" },
  ];
  const result = criticalPath(tasks, deps);
  assert.equal(result.totalDuration, 6);
  assert.deepEqual(result.taskIds, ["A", "B", "C"]);
});
