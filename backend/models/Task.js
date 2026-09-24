const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const Task = sequelize.define(
  "Task",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, defaultValue: "" },
    // Column on the Kanban board. Dependency "Blocked/Ready" state is
    // computed on the fly from the graph — it is never stored, so it can
    // never go stale.
    status: {
      type: DataTypes.ENUM("backlog", "in_progress", "review", "done"),
      defaultValue: "backlog",
    },
    startDate: { type: DataTypes.DATEONLY, allowNull: false },
    endDate: { type: DataTypes.DATEONLY, allowNull: false },
    duration: { type: DataTypes.INTEGER, allowNull: false }, // in days, fixed at creation
    position: { type: DataTypes.INTEGER, defaultValue: 0 }, // order within a column
  },
  { tableName: "tasks" }
);

module.exports = Task;
