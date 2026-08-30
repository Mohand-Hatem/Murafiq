import mongoose from 'mongoose';

const { Schema } = mongoose;

export const WARDROBE_CATEGORIES = ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'];
export const CLASSIFICATION_STATUS = {
  PENDING: 'pending',
  DONE: 'done',
  FAILED: 'failed',
};

const wardrobeItemSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: WARDROBE_CATEGORIES,
      index: true,
    },
    primaryColor: {
      type: String,
      trim: true,
    },
    secondaryColors: [{
      type: String,
      trim: true,
    }],
    pattern: {
      type: String,
      trim: true,
    },
    formality: {
      type: String,
      trim: true,
      index: true,
    },
    season: [{
      type: String,
      trim: true,
    }],
    material: {
      type: String,
      trim: true,
    },
    styleTags: [{
      type: String,
      trim: true,
    }],
    aiDescription: {
      type: String,
      trim: true,
    },
    embeddingId: {
      type: String,
      trim: true,
    },
    classificationStatus: {
      type: String,
      enum: Object.values(CLASSIFICATION_STATUS),
      default: CLASSIFICATION_STATUS.PENDING,
      index: true,
    },
    classificationError: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

wardrobeItemSchema.index({ userId: 1, category: 1 });
wardrobeItemSchema.index({ userId: 1, createdAt: -1 });

const WardrobeItem = mongoose.model('WardrobeItem', wardrobeItemSchema);
export default WardrobeItem;
