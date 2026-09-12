import mongoose from 'mongoose';

const { Schema } = mongoose;

const subscriptionSchema = new Schema(
  {
    // No field-level `index: true`: both compound indexes below lead with userId, so a
    // userId-only lookup is already served by their prefix, and a standalone `userId_1`
    // collides by name with the partial unique index.
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
      enum: ['active', 'cancelled', 'expired'],
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
    // NOT required: `null` is the load-bearing signal for "Free tier, never expires".
    // It is what findExpiringSubscriptions filters on, and what ensureUserSubscription
    // writes at registration. Marking it required made every free-plan Subscription.create()
    // throw a ValidationError -- which registration swallowed in a try/catch, leaving users
    // with no subscription row at all and making GET /subscriptions/me a guaranteed 500.
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    // How this subscription was obtained. Keeps an administrative comp distinguishable from
    // revenue: a paid plan has a SubscriptionOrder and a ledger charge behind it, an
    // admin_grant deliberately has neither (see admin.service.grantSubscription).
    source: {
      type: String,
      enum: ['free_default', 'paid', 'admin_grant'],
      default: 'free_default',
      index: true,
    },
    // Set only for source === 'admin_grant'.
    grantedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    grantReason: {
      type: String,
      trim: true,
      default: null,
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

// THE one-active-subscription invariant, enforced by the database rather than by a
// read-then-write in application code. Every grant path (registration's ensureUserSubscription,
// the Paymob webhook's subscribe(), and the admin manual grant) previously read the active row
// and then wrote it in two separate round-trips, so two concurrent callers could each see "no
// active subscription" and each create one -- leaving findActiveByUserId to pick arbitrarily
// between them via .sort({createdAt:-1}), and entitlements to flip depending on which won.
// Partial rather than plain: cancelled/expired rows are history and must be allowed to pile up.
subscriptionSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    // Named explicitly: the auto-generated name would be `userId_1`, which collides with any
    // other index on the same key and makes the createIndex failure read like a mystery.
    name: 'uniq_active_subscription_per_user',
  }
);

const Subscription = mongoose.model('Subscription', subscriptionSchema);

export default Subscription;
