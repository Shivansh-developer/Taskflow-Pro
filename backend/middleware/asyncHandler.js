// Wrap every async route handler with this. Express 4 does NOT automatically
// catch rejected promises from async functions — without this, a thrown
// error inside an `async (req, res) => {...}` route would crash the whole
// process instead of returning a clean error response.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
