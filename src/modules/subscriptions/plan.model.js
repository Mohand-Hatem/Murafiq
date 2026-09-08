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
    // A Plan deliberately has NO billingCycle of its own: one row offers both cycles and
    // carries both prices. A single cycle on the plan could only ever disagree with the
    // cycle the buyer selected, which is exactly the drift that made yearly billing charge
    // the monthly price for a 365-day period.
    priceEgp: {
      type: Number,
      required: true,
      min: 0,
    },
    // null = this plan has no yearly variant (the Free tiers). Selecting `yearly` against
    // a null price is rejected outright rather than silently falling back to priceEgp.
    priceYearlyEgp: {
      type: Number,
      min: 0,
      default: null,
    },
    priceUsdDisplay: {
      type: Number,
      min: 0,
    },
    priceUsdYearlyDisplay: {
      type: Number,
      min: 0,
      default: null,
    },
    entitlements: {
      type: Schema.Types.Mixed,
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
