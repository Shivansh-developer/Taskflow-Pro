/**
 * dag.js — the whole dependency engine lives here, deliberately separate
 * from Express routes so it can be unit tested / reasoned about in
 * isolation. Everything here works on plain JS objects, not Sequelize
 * instances, so routes are responsible for loading/saving.
 *
 * Task shape expected:  { id, status, startDate, endDate, duration }
 * Dependency shape:     { taskId, prerequisiteId }   // prerequisiteId -> taskId
 */

/** Build adjacency maps for fast traversal. */
function buildGraph(deps) {
  const forward = new Map(); // prerequisiteId -> [taskId, ...]   (downstream)
  const backward = new Map(); // taskId -> [prerequisiteId, ...]   (upstream)
  for (const d of deps) {
    if (!forward.has(d.prerequisiteId)) forward.set(d.prerequisiteId, []);
    forward.get(d.prerequisiteId).push(d.taskId);

    if (!backward.has(d.taskId)) backward.set(d.taskId, []);
    backward.get(d.taskId).push(d.prerequisiteId);
  }
  return { forward, backward };
}

/**
 * Would adding edge prerequisiteId -> taskId create a cycle, given the
 * existing edges? We simulate adding it, then try a full topological sort
 * (Kahn's algorithm). If every node can't be ordered, there's a cycle.
 */
function wouldCreateCycle(existingDeps, taskId, prerequisiteId) {
  if (taskId === prerequisiteId) return true; // self-dependency

  const deps = [...existingDeps, { taskId, prerequisiteId }];
  const { forward } = buildGraph(deps);

  const nodes = new Set();
  deps.forEach((d) => {
    nodes.add(d.taskId);
    nodes.add(d.prerequisiteId);
  });

  const indegree = new Map([...nodes].map((n) => [n, 0]));
  deps.forEach((d) => indegree.set(d.taskId, (indegree.get(d.taskId) || 0) + 1));

  const queue = [...nodes].filter((n) => indegree.get(n) === 0);
  let visited = 0;
  while (queue.length) {
    const n = queue.shift();
    visited++;
    for (const next of forward.get(n) || []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return visited !== nodes.size; // leftover nodes => cycle
}

/** Topological order of all task ids referenced by deps + the given task list. */
function topoOrder(taskIds, deps) {
  const { forward } = buildGraph(deps);
  const indegree = new Map(taskIds.map((id) => [id, 0]));
  deps.forEach((d) => {
    if (indegree.has(d.taskId)) {
      indegree.set(d.taskId, indegree.get(d.taskId) + 1);
    }
  });

  const queue = taskIds.filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const next of forward.get(n) || []) {
      if (!indegree.has(next)) continue;
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return order; // if graph is a valid DAG, order.length === taskIds.length
}

/**
 * Blocked / Ready status, derived fresh every time — never persisted.
 * A task is Blocked if ANY prerequisite is not "done".
 * A task with zero prerequisites is always Ready (w.r.t. dependencies).
 */
function computeDependencyStates(tasks, deps) {
  const { backward } = buildGraph(deps);
  const statusById = new Map(tasks.map((t) => [t.id, t.status]));

  const result = new Map();
  for (const t of tasks) {
    const prereqIds = backward.get(t.id) || [];
    const blocked = prereqIds.some((pid) => statusById.get(pid) !== "done");
    result.set(t.id, {
      blocked,
      ready: !blocked,
      prerequisiteIds: prereqIds,
    });
  }
  return result;
}

/**
 * Recompute start/end dates for every task in topological order.
 *
 * Design choice (this is what solves "No Compounding"): rather than
 * tracking a delta and adding it once per incoming edge, we recompute each
 * task's ABSOLUTE start date as `max(endDate of all its prerequisites)`.
 * Because it's a max over converging paths — not a sum — a change that
 * reaches a downstream task via two different paths is only ever counted
 * once. Duration per task is fixed, so endDate = startDate + duration.
 *
 * Tasks with no prerequisites keep whatever start date was set on them
 * directly (that's the "source of truth" edit a user just made, or their
 * original schedule).
 *
 * Returns a Map<taskId, { startDate, endDate, changed }>.
 */
function recomputeSchedule(tasks, deps) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const { backward } = buildGraph(deps);
  const order = topoOrder(
    tasks.map((t) => t.id),
    deps
  );

  const result = new Map();
  for (const id of order) {
    const task = byId.get(id);
    const prereqIds = backward.get(id) || [];

    let newStart = task.startDate;
    if (prereqIds.length > 0) {
      const prereqEnds = prereqIds
        .map((pid) => result.get(pid)?.endDate ?? byId.get(pid)?.endDate)
        .filter(Boolean);
      if (prereqEnds.length > 0) {
        const maxEnd = prereqEnds.reduce((a, b) => (a > b ? a : b));
        // earliest a downstream task can start is the day after its last
        // prerequisite finishes
        const d = new Date(maxEnd);
        d.setDate(d.getDate() + 1);
        const candidate = d.toISOString().slice(0, 10);
        if (candidate > task.startDate) newStart = candidate;
      }
    }

    const start = new Date(newStart);
    const end = new Date(start);
    end.setDate(end.getDate() + task.duration);
    const newEnd = end.toISOString().slice(0, 10);

    const changed = newStart !== task.startDate || newEnd !== task.endDate;
    result.set(id, { startDate: newStart, endDate: newEnd, changed });
  }
  return result;
}

/**
 * Longest path through the DAG by cumulative duration (critical path).
 * Returns { taskIds: [...in order...], totalDuration }.
 */
function criticalPath(tasks, deps) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const { backward } = buildGraph(deps);
  const order = topoOrder(
    tasks.map((t) => t.id),
    deps
  );

  const longest = new Map(); // taskId -> { length, prev }
  for (const id of order) {
    const prereqIds = backward.get(id) || [];
    if (prereqIds.length === 0) {
      longest.set(id, { length: byId.get(id).duration, prev: null });
      continue;
    }
    let best = { length: -Infinity, prev: null };
    for (const pid of prereqIds) {
      const l = (longest.get(pid)?.length ?? 0) + byId.get(id).duration;
      if (l > best.length) best = { length: l, prev: pid };
    }
    longest.set(id, best);
  }

  let endId = null;
  let max = -Infinity;
  for (const [id, v] of longest) {
    if (v.length > max) {
      max = v.length;
      endId = id;
    }
  }

  const pathIds = [];
  let cur = endId;
  while (cur) {
    pathIds.unshift(cur);
    cur = longest.get(cur)?.prev;
  }

  return { taskIds: pathIds, totalDuration: max === -Infinity ? 0 : max };
}

module.exports = {
  buildGraph,
  wouldCreateCycle,
  topoOrder,
  computeDependencyStates,
  recomputeSchedule,
  criticalPath,
};
