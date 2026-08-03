export const restrictTo = (..._roles) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(401, 'Unauthenticated'));
  }
  return next(new ApiError(501, 'RBAC middleware not yet implemented (Phase 1)'));
};

export default { restrictTo };
