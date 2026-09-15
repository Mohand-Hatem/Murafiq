import mongoose from 'mongoose';
import {
  WARDROBE_CATEGORIES,
  WARDROBE_PATTERNS,
  WARDROBE_FORMALITIES,
  WARDROBE_SEASONS,
  WARDROBE_MATERIALS,
  WARDROBE_FITS,
  WARDROBE_COLOR_FAMILIES,
  WARDROBE_GENDER_PRESENTATIONS,
} from '../../common/constants/wardrobe.constants.js';

const { Schema } = mongoose;

export {
  WARDROBE_CATEGORIES,
  WARDROBE_PATTERNS,
  WARDROBE_FORMALITIES,
  WARDROBE_SEASONS,
  WARDROBE_MATERIALS,
  WARDROBE_FITS,
  WARDROBE_COLOR_FAMILIES,
  WARDROBE_GENDER_PRESENTATIONS,
};
export const WARDROBE_ORIGINS = ['upload', 'chat_save'];

export const CLASSIFICATION_STATUS = {
  PENDING: 'pending',
  DONE: 'done',
  FAILED: 'failed',
  NEEDS_REVIEW: 'needs_review',
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
    sourceUploadRef: {
      type: String,
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
      enum: WARDROBE_PATTERNS,
      trim: true,
    },
    formality: {
      type: String,
      enum: WARDROBE_FORMALITIES,
      trim: true,
      index: true,
    },
    season: [{
      type: String,
      enum: WARDROBE_SEASONS,
      trim: true,
    }],
    material: {
      type: String,
      enum: WARDROBE_MATERIALS,
      trim: true,
    },
    subcategory: {
      type: String,
      trim: true,
    },
    fit: {
      type: String,
      enum: WARDROBE_FITS,
    },
    colorFamily: {
      type: String,
      enum: WARDROBE_COLOR_FAMILIES,
    },
    isNeutral: {
      type: Boolean,
      default: false,
    },
    genderPresentation: {
      type: String,
      enum: WARDROBE_GENDER_PRESENTATIONS,
      default: 'unisex',
      index: true,
    },
    printedText: {
      type: String,
      trim: true,
    },
    aiConfidence: {
      type: Number,
      min: 0,
      max: 1,
    },
    aiModel: {
      type: String,
      trim: true,
    },
    aiPromptVersion: {
      type: String,
      trim: true,
    },
    origin: {
      type: String,
      enum: WARDROBE_ORIGINS,
      default: 'upload',
    },
    lastWornAt: {
      type: Date,
    },
    wearCount: {
      type: Number,
      default: 0,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
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
wardrobeItemSchema.index({ userId: 1, category: 1, formality: 1 });
wardrobeItemSchema.index({ userId: 1, isArchived: 1 });
wardrobeItemSchema.index({ userId: 1, genderPresentation: 1 });

const WardrobeItem = mongoose.model('WardrobeItem', wardrobeItemSchema);
export default WardrobeItem;
