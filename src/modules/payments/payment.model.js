import mongoose from 'mongoose';
import { PAYMENT_STATUS } from '../../common/constants/statuses.constant.js';

const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      index: true,
    },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    currency: {
      type: String,
      default: 'EGP',
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    platformFeePercentage: {
      type: Number,
      default: 15,
    },
    platformFeeAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    stylistPayoutAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    // Coupon applied at checkout. `amount` is the DISCOUNTED total actually charged;
    // `grossAmount` preserves the pre-discount booking price so refunds, platform-fee
    // arithmetic and reconciliation can all still see what the booking was worth.
    couponCode: {
      type: String,
      trim: true,
      uppercase: true,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    grossAmount: {
      type: Number,
      min: 0,
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundReason: {
      type: String,
    },
    refundError: {
      type: String,
    },
    refundFailedAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
    refundTier: {
      type: String,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    provider: {
      type: String,
      enum: ['mock', 'paymob'],
      default: 'mock',
    },
    providerTransactionId: {
      type: String,
      sparse: true,
      index: true,
    },
    providerIntentionId: {
      type: String,
      sparse: true,
      index: true,
    },
    paidAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;
