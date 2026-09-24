require("dotenv").config();
const { Task, Dependency, init } = require("./models");

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seed() {
  await init();
  await Dependency.destroy({ where: {} });
  await Task.destroy({ where: {} });

  const base = "2026-09-22";

  const defs = [
    // The chain from the problem statement
    { key: "schema", title: "Database Schema", description: "Design tables, relationships and migrations.", duration: 3, status: "done" },
    { key: "api", title: "Backend API", description: "REST endpoints for tasks and dependencies.", duration: 5, status: "in_progress", deps: ["schema"] },
    { key: "tests", title: "Integration Tests", description: "End-to-end tests against the live API.", duration: 3, status: "backlog", deps: ["api"] },

    // A diamond convergence to demonstrate no-compounding propagation
    { key: "designSystem", title: "Design System", description: "Shared component library and tokens.", duration: 4, status: "done" },
    { key: "kanbanUI", title: "Kanban Board UI", description: "Drag-and-drop board with 4 columns.", duration: 5, status: "in_progress", deps: ["designSystem", "api"] },
    { key: "aiPanel", title: "AI Suggestion Panel", description: "Suggests dependencies from task text.", duration: 4, status: "backlog", deps: ["designSystem", "api"] },
    { key: "polish", title: "UI Polish & Review", description: "Converges both UI branches for final review.", duration: 2, status: "backlog", deps: ["kanbanUI", "aiPanel"] },

    // Independent / parallel work
    { key: "deploy", title: "Deployment Pipeline", description: "CI/CD + hosting for frontend and backend.", duration: 2, status: "backlog" },
    { key: "readme", title: "README & Submission Docs", description: "Setup guide, AI declaration, assumptions.", duration: 1, status: "backlog", deps: ["tests", "polish"] },
  ];

  const idByKey = {};
  let cursorDate = base;
  let position = 1;

  for (const d of defs) {
    const startDate = d.deps ? base : cursorDate; // real dates get corrected by propagation anyway
    const endDate = addDays(startDate, d.duration);
    const task = await Task.create({
      title: d.title,
      description: d.description,
      status: d.status,
      startDate,
      endDate,
      duration: d.duration,
      position: position++,
    });
    idByKey[d.key] = task.id;
    if (d.status !== "done") cursorDate = addDays(cursorDate, 1);
  }

  for (const d of defs) {
    if (!d.deps) continue;
    for (const depKey of d.deps) {
      await Dependency.create({
        taskId: idByKey[d.key],
        prerequisiteId: idByKey[depKey],
      });
    }
  }

  console.log(`Seeded ${defs.length} tasks with dependencies.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
