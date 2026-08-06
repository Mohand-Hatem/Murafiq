// Mongoose documents never leak directly to the HTTP response — this is the one allowed shape.
export const toPublicUser = (user) => ({
  id: user._id.toString(),
  nameEn: user.nameEn,
  nameAr: user.nameAr,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  accountStatus: user.accountStatus,
  createdAt: user.createdAt,
});
