import mongoose from 'mongoose';

const { Schema } = mongoose;

const subscriptionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    planCode: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['client', 'stylist'],
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly',
    },
    status: {
      type: String,
      enum: ['active', 'past_due', 'cancelled', 'expired'],
      default: 'active',
      index: true,
    },
    currentPeriodStart: {
      type: Date,
      required: true,
    },
    // A downgrade is SCHEDULED, never applied immediately (§E.5): the user paid for the
    // higher tier through the end of the period, and dropping their entitlements on the
    // spot both voids time they bought and resets the billing period they paid for.
    // The renewal sweep promotes these to the live plan once currentPeriodEnd passes.
    pendingPlanCode: {
      type: String,
      default: null,
    },
    pendingBillingCycle: {
      type: String,
      enum: ['monthly', 'yearly', null],
      default: null,
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    paymobSubscriptionId: {
      type: String,
      sparse: true,
      index: true,
    },
    paymobCardToken: {
      type: String,
      sparse: true,
    },
    paymobOrderId: {
      type: String,
      sparse: true,
    },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, currentPeriodStart: 1 }, { unique: true });
subscriptionSchema.index({ userId: 1, status: 1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);

export default Subscription;
