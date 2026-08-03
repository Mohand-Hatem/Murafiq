const notFoundMiddleware = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};

export default notFoundMiddleware;
