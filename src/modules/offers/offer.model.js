import mongoose from 'mongoose';
import { OFFER_STATUS } from '../../common/constants/statuses.constant.js';

const { Schema } = mongoose;

const offerSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'Request', required: true },
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestVisibility: {
      type: String,
      enum: ['direct', 'broadcast'],
      required: true,
      default: 'direct',
    },
    price: { type: Number, min: 100, required: true }, // Minimum 100 EGP binding price
    duration: { type: Number, required: true },        // Minutes
    message: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(OFFER_STATUS),
      default: OFFER_STATUS.PENDING,
    },
    expiresAt: Date,
    // Hard 30-day ceiling independent of expiresAt (offer.service.js:
    // "24-hour standard expiry, 30-day long-stop expiry"). Was previously absent from
    // this schema, so Mongoose's default strict mode silently stripped it on every
    // create -- the $or clause in expireOldOffers that checks it could never match
    // anything, and the long-stop expiry did not exist in practice.
    longStopExpiresAt: Date,
  },
  { timestamps: true }
);

offerSchema.index({ stylistId: 1, clientId: 1, status: 1 });
offerSchema.index({ stylistId: 1, status: 1 });
offerSchema.index({ requestId: 1, status: 1 });
offerSchema.index(
  { requestId: 1, stylistId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: [OFFER_STATUS.PENDING, OFFER_STATUS.ACCEPTED] } },
  }
);
offerSchema.index({ status: 1, expiresAt: 1 }, { background: true });

const Offer = mongoose.model('Offer', offerSchema);

export default Offer;

