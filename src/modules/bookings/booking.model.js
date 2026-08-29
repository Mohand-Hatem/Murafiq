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
      // Booking statuses stay lowercase-hyphen to match the pre-existing values
      // ('confirmed', 'in-progress'); the uppercase duplicates were never written.
      enum: [
        'confirmed',
        'in-progress',
        'completed',
        'cancelled',
        'disputed',
        'no-show-stylist',
        'no-show-client',
      ],
      default: 'confirmed',
    },
    isFrozen: { type: Boolean, default: false },
    frozenReason: String,
    frozenAt: Date,
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
    // Set exactly once, the moment status first becomes 'completed' (mutual confirmation or
    // a dispute resolved as 'completed'). Used as the anchor for the dispute-filing window and
    // payout-eligibility hold period — NOT `updatedAt`, which changes on unrelated writes
    // (e.g. payoutStatus flipping to 'processing') and would keep pushing both windows back.
    completedAt: Date,
    payoutStatus: {
      type: String,
      enum: ['unpaid', 'processing', 'paid'],
      default: 'unpaid',
    },
    payoutId: { type: Schema.Types.ObjectId, ref: 'Payout' },

    noShowDetails: {
      reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reportedAt: Date,
      // Which side is accused. Stored rather than derived from reportedBy so the
      // settlement path can never mis-attribute the penalty if the relation changes.
      reportedAgainst: { type: String, enum: ['client', 'stylist'] },
      respondedAt: Date,
      response: String,
      confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      confirmedAt: Date,
      evidence: [{ type: String, trim: true }],
    },

    disputeDetails: {
      raisedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      type: { type: String, default: 'general' },
      raisedAt: Date,
      evidence: [{ type: String, trim: true }],
    },
    disputeResolution: {
      outcome: { type: String, enum: ['completed', 'cancelled'] },
      refundPercentage: Number,
      resolutionNotes: String,
      resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: Date,
    },
  },
  { timestamps: true }
);

bookingSchema.index({ offerId: 1 }, { unique: true });
bookingSchema.index({ requestId: 1 }, { unique: true });
bookingSchema.index({ stylistId: 1, scheduledDate: 1, scheduledStartMinute: 1, scheduledEndMinute: 1 });
bookingSchema.index({ clientId: 1, createdAt: -1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ isFrozen: 1, payoutStatus: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;
