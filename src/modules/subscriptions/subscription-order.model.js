import mongoose from 'mongoose';

const { Schema } = mongoose;

const subscriptionOrderSchema = new Schema(
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
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly',
    },
    amountEgp: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      // 'processing' is a transient CAS-claimed state (subscription.service.js
      // handleSubscriptionWebhook): it is set the instant the HMAC-verified webhook
      // starts applying the plan grant, and moves on to 'paid' on success or back to
      // 'pending' on failure so a provider retry can actually retry the grant instead of
      // permanently short-circuiting on `status === 'paid'` with no entitlement ever
      // applied. See docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X5.
      enum: ['pending', 'processing', 'paid', 'failed'],
      default: 'pending',
      index: true,
    },
    provider: {
      type: String,
      enum: ['paymob', 'mock'],
      default: 'mock',
    },
    providerIntentionId: {
      type: String,
      sparse: true,
    },
    providerTransactionId: {
      type: String,
      sparse: true,
      index: true,
    },
    specialReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    paidAt: {
      type: Date,
    },
    rawCallbackData: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

const SubscriptionOrder = mongoose.model('SubscriptionOrder', subscriptionOrderSchema);

export default SubscriptionOrder;
