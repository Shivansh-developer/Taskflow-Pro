const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// An edge prerequisiteId -> taskId : `prerequisiteId` must be Done before
// `taskId` can be Ready.
const Dependency = sequelize.define(
  "Dependency",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    taskId: { type: DataTypes.UUID, allowNull: false },
    prerequisiteId: { type: DataTypes.UUID, allowNull: false },
  },
  {
    tableName: "dependencies",
    indexes: [{ unique: true, fields: ["taskId", "prerequisiteId"] }],
  }
);

module.exports = Dependency;
