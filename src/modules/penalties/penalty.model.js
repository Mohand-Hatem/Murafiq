import mongoose from 'mongoose';

const { Schema } = mongoose;

const penaltySchema = new Schema(
  {
    stylistId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    reasonType: {
      type: String,
      enum: ['LATE_CANCEL', 'EARLY_CANCEL', 'NO_SHOW', 'POLICY_VIOLATION'],
      required: true,
    },
    assessedMinor: {
      type: Number, // Integer piastres
      required: true,
      min: 0,
    },
    settledMinor: {
      type: Number, // Integer piastres
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['OUTSTANDING', 'PARTIALLY_SETTLED', 'SETTLED', 'WAIVED'],
      default: 'OUTSTANDING',
      index: true,
    },
    waivedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    waivedReason: {
      type: String,
    },
    waivedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

penaltySchema.index({ bookingId: 1, reasonType: 1 }, { unique: true });
penaltySchema.index({ stylistId: 1, status: 1 });

const Penalty = mongoose.model('Penalty', penaltySchema);

export default Penalty;
