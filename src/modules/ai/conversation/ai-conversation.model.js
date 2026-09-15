import mongoose from 'mongoose';

const { Schema } = mongoose;

const aiConversationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
      default: 'New Conversation',
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for user conversations sorted by most recent activity
aiConversationSchema.index({ userId: 1, lastMessageAt: -1 });

const AiConversation = mongoose.model('AiConversation', aiConversationSchema);

export default AiConversation;
