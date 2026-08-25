import mongoose from 'mongoose';

const { Schema } = mongoose;

const requestSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    visibility: {
      type: String,
      enum: ['direct', 'broadcast'],
      required: true,
      default: 'direct',
    },
    stylistId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
        return this.visibility === 'direct';
      },
    },
    title: { type: String, required: true, trim: true },
    date: Date,
    time: String,
    meetingLocation: {
      address: { type: String, trim: true },
      country: { type: String, trim: true },
      governorate: { type: String, trim: true },
      city: { type: String, trim: true },
      area: { type: String, trim: true },
      location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] },
      },
    },
    description: { type: String, trim: true },
    budgetRange: {
      min: { type: Number, min: 100 },
      max: { type: Number, min: 100 },
    },
    images: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: ['pending', 'offered', 'accepted', 'rejected', 'expired', 'cancelled'],
      default: 'pending',
    },
    expiresAt: Date,
  },
  { timestamps: true }
);

requestSchema.index({ clientId: 1, createdAt: -1 });
requestSchema.index({ stylistId: 1, createdAt: -1 });
requestSchema.index({ expiresAt: 1, status: 1 });
requestSchema.index({ 'meetingLocation.location': '2dsphere' });
requestSchema.index({
  visibility: 1,
  status: 1,
  'meetingLocation.governorate': 1,
  createdAt: -1,
});

const Request = mongoose.model('Request', requestSchema);

export default Request;

