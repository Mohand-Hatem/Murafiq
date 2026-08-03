const authMiddleware = (req, res, next) => {
  return next(new ApiError(501, 'Auth middleware not yet implemented (Phase 1)'));
};

export default authMiddleware;
