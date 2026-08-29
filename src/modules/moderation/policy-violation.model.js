import mongoose from 'mongoose';

const { Schema } = mongoose;

const policyViolationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    violationType: {
      type: String,
      enum: ['CONTACT_EXCHANGE', 'HARASSMENT', 'SPAM', 'FRAUD', 'CIRCUMVENTION'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
    },
    enforcementAction: {
      type: String,
      enum: ['WARN', 'RESTRICT', 'SUSPEND', 'BAN'],
      required: true,
    },
    moderationEventId: {
      type: Schema.Types.ObjectId,
      ref: 'ModerationEvent',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'RESOLVED', 'EXPIRED'],
      default: 'ACTIVE',
      index: true,
    },
    expiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

policyViolationSchema.index({ userId: 1, status: 1 });
policyViolationSchema.index({ createdAt: -1 });

const PolicyViolation = mongoose.model('PolicyViolation', policyViolationSchema);

export default PolicyViolation;
