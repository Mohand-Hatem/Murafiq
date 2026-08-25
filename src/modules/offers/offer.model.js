import mongoose from 'mongoose';

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
      enum: ['pending', 'accepted', 'rejected', 'expired'],
      default: 'pending',
    },
    expiresAt: Date,
  },
  { timestamps: true }
);

offerSchema.index({ stylistId: 1, clientId: 1, status: 1 });
offerSchema.index({ requestId: 1, status: 1 });
offerSchema.index({ requestId: 1, stylistId: 1 }, { unique: true });

const Offer = mongoose.model('Offer', offerSchema);

export default Offer;

