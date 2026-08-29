import mongoose from 'mongoose';

const { Schema } = mongoose;

const couponSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    discountPercentage: {
      type: Number,
      default: 10,
      min: 1,
      max: 100,
    },
    maxDiscountEgp: {
      type: Number,
      default: 150,
      min: 0,
    },
    status: {
      type: String,
      enum: ['ISSUED', 'REDEEMED', 'EXPIRED', 'VOIDED'],
      default: 'ISSUED',
      index: true,
    },
    issuedReason: {
      type: String,
      enum: ['NO_SHOW_COMPENSATION', 'LATE_CANCEL_COMPENSATION', 'MARKETING'],
      default: 'NO_SHOW_COMPENSATION',
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    // The booking whose failure caused this coupon to be issued. Combined with the
    // unique index below it makes issuance idempotent: a no-show resolution that runs
    // twice (retry, duplicate webhook, admin double-click) cannot mint two coupons.
    sourceBookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
    },
    redeemedOnBookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
    },
    redeemedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

couponSchema.index({ recipientId: 1, status: 1 });

// Partial so that marketing coupons — which have no source booking — are exempt and can
// be issued in bulk without colliding on a null sourceBookingId.
couponSchema.index(
  { sourceBookingId: 1, issuedReason: 1 },
  { unique: true, partialFilterExpression: { sourceBookingId: { $exists: true } } }
);

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon;
