import mongoose from 'mongoose';

const { Schema } = mongoose;

const moderationEventSchema = new Schema(
  {
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    messageSnippet: {
      type: String,
      trim: true,
    },
    matchedLayer: {
      type: String,
      enum: [
        'NORMALIZATION',
        'REGEX_CONTACT',
        'DOMAIN_DENYLIST',
        'WORD_LIST',
        'CLASSIFIER',
        'USER_REPORT',
      ],
      required: true,
    },
    matchedRule: {
      type: String,
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
    },
    actionTaken: {
      type: String,
      enum: ['ALLOW', 'BLOCK_ONLY', 'OBSERVED', 'RESTRICT', 'BAN'],
      default: 'OBSERVED',
    },
    reviewStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'DISMISSED'],
      default: 'PENDING',
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
    reviewNotes: {
      type: String,
    },
  },
  { timestamps: true }
);

moderationEventSchema.index({ senderId: 1, createdAt: -1 });
moderationEventSchema.index({ reviewStatus: 1, createdAt: -1 });

const ModerationEvent = mongoose.model('ModerationEvent', moderationEventSchema);

export default ModerationEvent;
