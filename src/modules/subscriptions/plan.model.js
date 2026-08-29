import mongoose from 'mongoose';

const { Schema } = mongoose;

const planSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['client', 'stylist'],
      required: true,
      index: true,
    },
    tier: {
      type: String,
      enum: ['free', 'basic', 'pro', 'enterprise'],
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly',
    },
    priceEgp: {
      type: Number,
      required: true,
      min: 0,
    },
    priceUsdDisplay: {
      type: Number,
      min: 0,
    },
    entitlements: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

planSchema.index({ role: 1, isActive: 1 });

const Plan = mongoose.model('Plan', planSchema);

export default Plan;
