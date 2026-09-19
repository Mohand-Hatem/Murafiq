import mongoose from 'mongoose';

const shapeModelSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    publicId: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    format: {
      type: String,
      trim: true,
      default: 'jpg',
    },
    bytes: {
      type: Number,
      default: 0,
    },
    width: {
      type: Number,
      default: 0,
    },
    height: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'replaced', 'deleted'],
      default: 'active',
      index: true,
    },
    consentAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    replacedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Partial unique index: At most ONE 'active' shape model per user
shapeModelSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

// Chronological history index for user audit
shapeModelSchema.index({ userId: 1, createdAt: -1 });

export const ShapeModel = mongoose.model('ShapeModel', shapeModelSchema);
export default ShapeModel;
