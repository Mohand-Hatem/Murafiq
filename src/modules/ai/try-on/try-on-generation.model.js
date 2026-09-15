import mongoose from 'mongoose';

const garmentItemSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['wardrobe', 'upload'],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WardrobeItem',
      default: null,
    },
    imageRef: {
      type: String,
      default: null,
      trim: true,
    },
    slot: {
      type: String,
      enum: ['top', 'bottom', 'outerwear', 'shoes', 'dress', 'accessory'],
      required: true,
    },
    label: {
      type: String,
      trim: true,
      default: '',
    },
    resolvedPublicId: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const tryOnGenerationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    shapeModelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShapeModel',
      required: true,
    },
    garments: {
      type: [garmentItemSchema],
      required: true,
      validate: [
        (val) => Array.isArray(val) && val.length >= 1 && val.length <= 4,
        'A try-on request must contain between 1 and 4 garments',
      ],
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    jobId: {
      type: String,
      required: true,
      index: true,
    },
    promptVersion: {
      type: String,
      default: 'v1',
      trim: true,
    },
    resolution: {
      type: String,
      enum: ['512x512', '1024x1024'],
      default: '1024x1024',
    },
    resultPublicId: {
      type: String,
      default: null,
      trim: true,
    },
    resultUrl: {
      type: String,
      default: null,
      trim: true,
    },
    errorMessage: {
      type: String,
      default: null,
      trim: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    quotaSource: {
      type: String,
      enum: ['monthly', 'lifetime'],
      required: true,
    },
    quotaRefunded: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
tryOnGenerationSchema.index({ userId: 1, createdAt: -1 });
tryOnGenerationSchema.index({ jobId: 1, createdAt: -1 });
tryOnGenerationSchema.index(
  { jobId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'processing'] } },
    name: 'uniq_active_job_id',
  }
);

export const TryOnGeneration = mongoose.model('TryOnGeneration', tryOnGenerationSchema);
export default TryOnGeneration;
