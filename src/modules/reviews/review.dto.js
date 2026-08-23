export const toReviewDto = (doc) => {
  if (!doc) return null;
  return {
    id: doc._id || doc.id,
    bookingId: doc.bookingId?._id || doc.bookingId,
    raterId: doc.raterId?._id || doc.raterId,
    revieweeId: doc.revieweeId?._id || doc.revieweeId,
    direction: doc.direction,
    rating: doc.rating,
    comment: doc.comment || null,
    isHidden: Boolean(doc.isHidden),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const toPublicReviewDto = (doc) => {
  if (!doc) return null;
  const rater = doc.raterId || {};
  return {
    id: doc._id || doc.id,
    rating: doc.rating,
    comment: doc.comment || null,
    createdAt: doc.createdAt,
    client: {
      name: rater.name || 'Anonymous Client',
      profileImage: rater.profileImage || null,
    },
  };
};

export default {
  toReviewDto,
  toPublicReviewDto,
};
