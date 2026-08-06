export const restrictTo =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Unauthenticated'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Forbidden'));
    }
    return next();
  };

export default { restrictTo };
