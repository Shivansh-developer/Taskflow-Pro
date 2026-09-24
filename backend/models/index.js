const sequelize = require("../db");
const Task = require("./Task");
const Dependency = require("./Dependency");

// A task can have many prerequisites and many dependents.
Task.hasMany(Dependency, { foreignKey: "taskId", as: "prerequisiteLinks" });
Task.hasMany(Dependency, {
  foreignKey: "prerequisiteId",
  as: "dependentLinks",
});

async function init() {
  await sequelize.sync(); // creates tables if they don't exist
}

module.exports = { sequelize, Task, Dependency, init };
