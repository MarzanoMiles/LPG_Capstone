const ApiError = require("../utils/apiError");

function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, next) {
  const statusCode = err instanceof ApiError ? err.statusCode : err.statusCode || 500;
  if (!(err instanceof ApiError)) {
    console.error(err);
  }
  res.status(statusCode).json({
    error: err.message || "Something went wrong on the server.",
  });
}

module.exports = { notFound, errorHandler };