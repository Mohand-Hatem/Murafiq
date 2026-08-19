import mongoose from 'mongoose';

const { Schema } = mongoose;

const bookingSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'Request', required: true },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scheduledDate: { type: Date, required: true },
    scheduledStartMinute: { type: Number, required: true }, // integer minutes since midnight
    scheduledEndMinute: { type: Number, required: true },   // integer minutes since midnight
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
    price: { type: Number, required: true, min: 100 },
    duration: { type: Number, required: true }, // in minutes
    status: {
      type: String,
      enum: ['confirmed', 'in-progress', 'completed', 'cancelled', 'disputed'],
      default: 'confirmed',
    },
    checkInAt: Date,
    checkInLocation: {
      lat: Number,
      lng: Number,
    },
    clientConfirmedAt: Date,
    stylistConfirmedAt: Date,
    liveTrackingEnabled: { type: Boolean, default: false },
    cancelledBy: { type: String, enum: ['client', 'stylist', 'admin'] },
    cancellationReason: String,
    cancelledAt: Date,
  },
  { timestamps: true }
);

bookingSchema.index({ stylistId: 1, scheduledDate: 1, scheduledStartMinute: 1, scheduledEndMinute: 1 });
bookingSchema.index({ clientId: 1, createdAt: -1 });
bookingSchema.index({ status: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;
