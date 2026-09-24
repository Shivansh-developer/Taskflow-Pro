const express = require("express");
const { Task, Dependency } = require("../models");
const {
  wouldCreateCycle,
  computeDependencyStates,
  recomputeSchedule,
  criticalPath,
} = require("../dag");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

/** Load all tasks + deps from DB as plain objects, and attach computed state. */
async function loadEnrichedTasks() {
  const tasks = (await Task.findAll({ order: [["position", "ASC"]] })).map(
    (t) => t.toJSON()
  );
  const deps = (await Dependency.findAll()).map((d) => d.toJSON());
  const states = computeDependencyStates(tasks, deps);

  const enriched = tasks.map((t) => ({
    ...t,
    blocked: states.get(t.id).blocked,
    ready: states.get(t.id).ready,
    prerequisiteIds: states.get(t.id).prerequisiteIds,
  }));

  return { tasks: enriched, rawTasks: tasks, deps };
}

// GET /api/tasks — full board state
router.get("/", asyncHandler(async (req, res) => {
  const { tasks } = await loadEnrichedTasks();
  res.json(tasks);
}));

// GET /api/tasks/critical-path
router.get("/critical-path", asyncHandler(async (req, res) => {
  const { rawTasks, deps } = await loadEnrichedTasks();
  res.json(criticalPath(rawTasks, deps));
}));

// POST /api/tasks — create a task, optionally with prerequisiteIds
router.post("/", asyncHandler(async (req, res) => {
  const { title, description, startDate, duration, prerequisiteIds, status } =
    req.body;

  if (!title || !startDate || !duration) {
    return res
      .status(400)
      .json({ error: "title, startDate and duration are required" });
  }

  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + Number(duration));

  const maxPos = (await Task.max("position")) || 0;

  const task = await Task.create({
    title,
    description: description || "",
    status: status || "backlog",
    startDate,
    endDate: end.toISOString().slice(0, 10),
    duration: Number(duration),
    position: maxPos + 1,
  });

  if (Array.isArray(prerequisiteIds)) {
    const deps = (await Dependency.findAll()).map((d) => d.toJSON());
    for (const prereqId of prerequisiteIds) {
      if (prereqId === task.id) continue;
      if (wouldCreateCycle(deps, task.id, prereqId)) continue; // silently skip invalid ones at creation
      await Dependency.create({ taskId: task.id, prerequisiteId: prereqId });
      deps.push({ taskId: task.id, prerequisiteId: prereqId });
    }
  }

  const { tasks } = await loadEnrichedTasks();
  res.status(201).json(tasks.find((t) => t.id === task.id));
}));

// PUT /api/tasks/:id — update status/position/title/description/dates
router.put("/:id", asyncHandler(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const { title, description, status, position, startDate, duration } =
    req.body;

  const dateOrDurationChanged =
    (startDate !== undefined && startDate !== task.startDate) ||
    (duration !== undefined && Number(duration) !== task.duration);

  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (status !== undefined) task.status = status;
  if (position !== undefined) task.position = position;

  if (startDate !== undefined) task.startDate = startDate;
  if (duration !== undefined) task.duration = Number(duration);

  if (dateOrDurationChanged) {
    const start = new Date(task.startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + task.duration);
    task.endDate = end.toISOString().slice(0, 10);
  }

  await task.save();

  // Propagate schedule changes downstream whenever dates/duration moved.
  if (dateOrDurationChanged) {
    const allTasks = (await Task.findAll()).map((t) => t.toJSON());
    const deps = (await Dependency.findAll()).map((d) => d.toJSON());
    const recomputed = recomputeSchedule(allTasks, deps);

    for (const [id, val] of recomputed) {
      if (val.changed) {
        await Task.update(
          { startDate: val.startDate, endDate: val.endDate },
          { where: { id } }
        );
      }
    }
  }

  // Rollback-on-regression: moving a task OUT of "done" doesn't need any
  // special-case code — Blocked/Ready is always recomputed live from
  // current statuses in loadEnrichedTasks(), so downstream tasks simply
  // reflect the new (unsatisfied) prerequisite state on the next GET.

  const { tasks } = await loadEnrichedTasks();
  res.json(tasks.find((t) => t.id === task.id));
}));

// DELETE /api/tasks/:id
router.delete("/:id", asyncHandler(async (req, res) => {
  await Dependency.destroy({
    where: { [require("sequelize").Op.or]: [{ taskId: req.params.id }, { prerequisiteId: req.params.id }] },
  });
  await Task.destroy({ where: { id: req.params.id } });
  res.status(204).end();
}));

// POST /api/tasks/:id/dependencies { prerequisiteId }
router.post("/:id/dependencies", asyncHandler(async (req, res) => {
  const { prerequisiteId } = req.body;
  const taskId = req.params.id;

  if (!prerequisiteId) {
    return res.status(400).json({ error: "prerequisiteId is required" });
  }
  if (prerequisiteId === taskId) {
    return res.status(400).json({ error: "A task cannot depend on itself" });
  }

  const [task, prereq] = await Promise.all([
    Task.findByPk(taskId),
    Task.findByPk(prerequisiteId),
  ]);
  if (!task || !prereq) {
    return res.status(404).json({ error: "Task not found" });
  }

  const deps = (await Dependency.findAll()).map((d) => d.toJSON());
  if (wouldCreateCycle(deps, taskId, prerequisiteId)) {
    return res.status(409).json({
      error:
        "This dependency would create a circular relationship (a cycle) in the graph. It was not added, and the existing graph is unchanged.",
    });
  }

  const existing = await Dependency.findOne({
    where: { taskId, prerequisiteId },
  });
  if (existing) {
    return res.status(409).json({ error: "This dependency already exists" });
  }

  await Dependency.create({ taskId, prerequisiteId });

  // A newly added prerequisite can immediately push the dependent task's
  // start date forward — recompute the whole schedule.
  const allTasks = (await Task.findAll()).map((t) => t.toJSON());
  const allDeps = (await Dependency.findAll()).map((d) => d.toJSON());
  const recomputed = recomputeSchedule(allTasks, allDeps);
  for (const [id, val] of recomputed) {
    if (val.changed) {
      await Task.update(
        { startDate: val.startDate, endDate: val.endDate },
        { where: { id } }
      );
    }
  }

  const { tasks } = await loadEnrichedTasks();
  res.status(201).json(tasks.find((t) => t.id === taskId));
}));

// DELETE /api/tasks/:id/dependencies/:prereqId
router.delete("/:id/dependencies/:prereqId", asyncHandler(async (req, res) => {
  await Dependency.destroy({
    where: { taskId: req.params.id, prerequisiteId: req.params.prereqId },
  });
  const { tasks } = await loadEnrichedTasks();
  res.json(tasks.find((t) => t.id === req.params.id));
}));

module.exports = router;
