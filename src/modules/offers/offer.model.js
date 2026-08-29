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

const Offer = mongoose.model('Offer', offerSchema);

export default Offer;

