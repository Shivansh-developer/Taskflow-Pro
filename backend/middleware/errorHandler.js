// Centralized error handler — the last middleware in the chain (see
// server.js). Anything thrown/rejected in a route wrapped with
// asyncHandler() ends up here, so every error response has a consistent
// shape and nothing ever leaks a raw stack trace to the client.
function errorHandler(err, req, res, next) {
  console.error(err);

  // Sequelize validation errors -> 400 with the specific field messages
  if (err.name === "SequelizeValidationError" || err.name === "SequelizeUniqueConstraintError") {
    return res.status(400).json({
      error: "Validation failed",
      details: err.errors?.map((e) => e.message),
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? "Something went wrong on the server." : err.message,
  });
}

// 404 handler for unknown routes — kept separate from errorHandler so it
// only fires when nothing matched, not on every error.
function notFound(req, res) {
  res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
