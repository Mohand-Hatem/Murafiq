import mongoose from 'mongoose';

const { Schema } = mongoose;

const usageCounterSchema = new Schema(
  {
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    metric: {
      type: String,
      required: true,
      index: true,
    },
    periodKey: {
      type: String, // e.g. "2026-08-27"
      required: true,
      index: true,
    },
    used: {
      type: Number,
      default: 0,
      min: 0,
    },
    expiresAt: {
      type: Date,
      index: { expires: 0 }, // TTL index for automatic expiry
    },
  },
  { timestamps: true }
);

usageCounterSchema.index({ subjectId: 1, metric: 1, periodKey: 1 }, { unique: true });

const UsageCounter = mongoose.model('UsageCounter', usageCounterSchema);

export default UsageCounter;
