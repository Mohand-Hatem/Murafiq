import mongoose from 'mongoose';

const { Schema } = mongoose;

const externalSuggestionSchema = new Schema(
  {
    type: { type: String, trim: true },
    description: { type: String, trim: true },
    sourceUrl: { type: String, trim: true, default: null },
    sourceTitle: { type: String, trim: true, default: null },
    imageUrl: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const eventContextSchema = new Schema(
  {
    eventType: { type: String, trim: true },
    formality: [{ type: String, trim: true }],
    season: { type: String, trim: true },
    timeOfDay: { type: String, trim: true },
    setting: { type: String, trim: true },
  },
  { _id: false }
);

const outfitSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiConversation',
      default: null,
      index: true,
    },
    items: [
      {
        type: Schema.Types.ObjectId,
        ref: 'WardrobeItem',
        required: true,
      },
    ],
    anchorItemId: {
      type: Schema.Types.ObjectId,
      ref: 'WardrobeItem',
      default: null,
    },
    externalSuggestions: {
      type: [externalSuggestionSchema],
      default: [],
    },
    eventContext: {
      type: eventContextSchema,
      default: () => ({}),
    },
    rationale: {
      type: String,
      trim: true,
      default: '',
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    source: {
      type: String,
      enum: ['wardrobe', 'external'],
      default: 'wardrobe',
    },
    userFeedback: {
      type: String,
      enum: ['liked', 'disliked', null],
      default: null,
    },
    promptVersion: {
      type: String,
      trim: true,
      default: 'v1.0.0',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for user outfit history queries sorted by recency
outfitSchema.index({ userId: 1, createdAt: -1 });

const Outfit = mongoose.model('Outfit', outfitSchema);

export default Outfit;
