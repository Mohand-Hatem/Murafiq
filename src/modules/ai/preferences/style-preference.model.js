import mongoose from 'mongoose';
import {
  WARDROBE_COLOR_FAMILIES,
  WARDROBE_FORMALITIES,
} from '../../../common/constants/wardrobe.constants.js';

const { Schema } = mongoose;

export const MODESTY_PREFERENCES = Object.freeze(['modest', 'standard', 'relaxed']);

const sizesSchema = new Schema(
  {
    top: { type: String, trim: true, default: '' },
    bottom: { type: String, trim: true, default: '' },
    shoes: { type: String, trim: true, default: '' },
    outerwear: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const stylePreferenceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    favoriteColors: {
      type: [
        {
          type: String,
          enum: WARDROBE_COLOR_FAMILIES,
        },
      ],
      default: [],
    },
    avoidedColors: {
      type: [
        {
          type: String,
          enum: WARDROBE_COLOR_FAMILIES,
        },
      ],
      default: [],
    },
    preferredFormality: {
      type: String,
      enum: [...WARDROBE_FORMALITIES, null],
      default: null,
    },
    sizes: {
      type: sizesSchema,
      default: () => ({}),
    },
    dislikedStyleTags: {
      type: [
        {
          type: String,
          trim: true,
        },
      ],
      default: [],
    },
    modestyPreference: {
      type: String,
      enum: MODESTY_PREFERENCES,
      default: 'standard',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const StylePreference = mongoose.model('StylePreference', stylePreferenceSchema);

export default StylePreference;
