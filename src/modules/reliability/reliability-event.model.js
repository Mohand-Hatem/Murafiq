import mongoose from 'mongoose';

const { Schema } = mongoose;

const reliabilityEventSchema = new Schema(
  {
    stylistId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        'SESSION_COMPLETED',
        'EARLY_CANCEL',
        'LATE_CANCEL',
        'NO_SHOW',
        'DISPUTE_LOST',
        'ADMIN_ADJUSTMENT',
      ],
      required: true,
    },
    deltaScore: {
      type: Number,
      required: true,
    },
    scoreBefore: {
      type: Number,
      required: true,
    },
    scoreAfter: {
      type: Number,
      required: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
    },
    reason: {
      type: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

reliabilityEventSchema.index({ stylistId: 1, createdAt: -1 });

const ReliabilityEvent = mongoose.model('ReliabilityEvent', reliabilityEventSchema);

export default ReliabilityEvent;
