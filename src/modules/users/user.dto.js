export const toUserProfileDto = (user) => {
  if (!user) return null;
  const doc = user.toObject ? user.toObject() : user;

  return {
    id: doc._id?.toString() || doc.id,
    name: doc.name,
    email: doc.email,
    phone: doc.phone || null,
    role: doc.role,
    profileImage: doc.profileImage,
    isEmailVerified: doc.isEmailVerified,
    accountStatus: doc.accountStatus,
    country: doc.country || null,
    governorate: doc.governorate || null,
    city: doc.city || null,
    area: doc.area || null,
    location: doc.location || { type: 'Point', coordinates: [0, 0] },
    verification: doc.verification || { status: 'unverified', documents: [] },
    isOnline: doc.isOnline || false,
    clientRating: doc.clientRating || 0,
    clientTotalReviews: doc.clientTotalReviews || 0,
    completedBookings: doc.completedBookings || 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const toPublicClientDto = (user) => {
  if (!user) return null;
  const doc = user.toObject ? user.toObject() : user;

  return {
    id: doc._id?.toString() || doc.id,
    name: doc.name,
    role: doc.role,
    profileImage: doc.profileImage || null,
    isIdentityVerified: doc.verification?.status === 'verified',
    completedBookings: doc.completedBookings || 0,
    clientRating: doc.clientRating || 0,
    clientTotalReviews: doc.clientTotalReviews || 0,
    country: doc.country || null,
    governorate: doc.governorate || null,
    city: doc.city || null,
    area: doc.area || null,
    memberSince: doc.createdAt,
  };
};

export default {
  toUserProfileDto,
  toPublicClientDto,
};
