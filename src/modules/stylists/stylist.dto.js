/**
 * Privacy-first public mapper for Stylist profiles.
 * Strips out email, phone, passwordHash, verification documents, and sensitive fields.
 */
export const toPublicStylistDto = (stylistProfile) => {
  if (!stylistProfile) return null;
  const doc = stylistProfile.toObject ? stylistProfile.toObject() : stylistProfile;
  const user = doc.userId && typeof doc.userId === 'object' ? doc.userId : {};

  return {
    id: doc._id?.toString() || doc.id,
    userId: user._id?.toString() || (typeof doc.userId === 'string' ? doc.userId : undefined),
    name: user.name || '',
    profileImage: user.profileImage || null,
    specialty: doc.specialty,
    bio: doc.bio || '',
    serviceDescription: doc.serviceDescription || '',
    experienceYears: doc.experienceYears || 0,
    languages: doc.languages || [],
    services: doc.services || [],
    hourlyPrice: doc.hourlyPrice,
    portfolio: doc.portfolio || [],
    workingAreas: doc.workingAreas || [],
    weeklyAvailability: doc.weeklyAvailability || [],
    rating: doc.rating || 0,
    totalReviews: doc.totalReviews || 0,
    completedSessions: doc.completedSessions || 0,
    gender: doc.gender || null,
    country: doc.country || null,
    governorate: doc.governorate || null,
    city: doc.city || null,
    area: doc.area || null,
    location: doc.location || { type: 'Point', coordinates: [0, 0] },
    locationSet: doc.locationSet || false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};
