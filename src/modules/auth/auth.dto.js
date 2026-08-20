// Mongoose documents never leak directly to the HTTP response — this is the one allowed shape.
export const toPublicUser = (user) => ({
  id: (user._id || user.id).toString(),
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  accountStatus: user.accountStatus,
  createdAt: user.createdAt,
});
