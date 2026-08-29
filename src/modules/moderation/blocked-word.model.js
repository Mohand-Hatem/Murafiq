import mongoose from 'mongoose';

const { Schema } = mongoose;

const blockedWordSchema = new Schema(
  {
    word: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    language: {
      type: String,
      enum: ['ar', 'en', 'both'],
      default: 'both',
    },
    category: {
      type: String,
      enum: ['PROFANITY', 'INSULT', 'SEXUAL', 'HATE', 'THREAT', 'HARASSMENT'],
      default: 'PROFANITY',
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

blockedWordSchema.index({ isActive: 1, language: 1 });

const BlockedWord = mongoose.model('BlockedWord', blockedWordSchema);

export default BlockedWord;
