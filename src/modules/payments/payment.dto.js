export const toPublicPaymentDto = (payment) => {
  if (!payment) return null;
  const doc = payment.toObject ? payment.toObject() : payment;

  return {
    id: doc._id?.toString() || doc.id,
    bookingId: doc.bookingId?._id ? doc.bookingId._id.toString() : (doc.bookingId?.toString() || doc.bookingId),
    clientId: doc.clientId?._id ? doc.clientId._id.toString() : (doc.clientId?.toString() || doc.clientId),
    currency: doc.currency || 'EGP',
    amount: doc.amount,
    platformFeePercentage: doc.platformFeePercentage,
    platformFeeAmount: doc.platformFeeAmount,
    stylistPayoutAmount: doc.stylistPayoutAmount,
    status: doc.status,
    refundAmount: doc.refundAmount || 0,
    refundReason: doc.refundReason || null,
    provider: doc.provider,
    paidAt: doc.paidAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export default {
  toPublicPaymentDto,
};
