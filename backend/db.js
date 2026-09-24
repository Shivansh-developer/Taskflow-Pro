const { Sequelize } = require("sequelize");
const path = require("path");

// SQLite chosen for zero-setup local persistence (matches the "any modern
// storage" requirement). Swap the `dialect`/`storage` below for Postgres in
// production by pointing to a DATABASE_URL — see README.
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: path.join(__dirname, "taskflow.sqlite"),
  logging: false,
});

module.exports = sequelize;
