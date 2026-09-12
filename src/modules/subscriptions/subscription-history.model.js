import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Append-only record of every Subscription plan transition.
 *
 * The `Subscription` document is a single mutable row per user -- `subscribe()`, the admin grant
 * and the renewal sweep all overwrite `planCode` / `currentPeriodStart` / `currentPeriodEnd` in
 * place. That makes the live row correct but destroys the answer to "what was this user on last
 * month, and who changed it?", which support and billing disputes both need. Snapshot the state
 * being REPLACED here before overwriting it.
 *
 * Deliberately not a ledger: this records entitlement state, never money. A paid transition's
 * money lives in SubscriptionOrder + LedgerEntry; an admin grant has neither by design.
 */
const subscriptionHistorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      index: true,
    },
    // What caused the transition. 'admin_grant' covers upgrade, downgrade and revoke alike --
    // they are one operation from the admin's side.
    changeType: {
      type: String,
      enum: [
        'paid',
        'admin_grant',
        'self_service',
        'expiry_sweep',
        'scheduled_downgrade',
        'cancellation',
      ],
      required: true,
      index: true,
    },

    // --- State being replaced (null when the user had no subscription yet) ---
    previousPlanCode: { type: String, default: null },
    previousBillingCycle: { type: String, default: null },
    previousStatus: { type: String, default: null },
    previousSource: { type: String, default: null },
    previousPeriodStart: { type: Date, default: null },
    previousPeriodEnd: { type: Date, default: null },

    // --- State being written ---
    newPlanCode: { type: String, required: true },
    newBillingCycle: { type: String, default: null },
    newSource: { type: String, default: null },
    newPeriodStart: { type: Date, default: null },
    newPeriodEnd: { type: Date, default: null },

    // Actor. null for system-driven transitions (expiry sweep, webhook).
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    changeReason: { type: String, trim: true, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

subscriptionHistorySchema.index({ userId: 1, createdAt: -1 });

// Same immutability posture as LedgerEntry: history that can be edited is not history.
const blockMutation = function () {
  throw new Error('Subscription history entries are immutable and cannot be modified or deleted.');
};

subscriptionHistorySchema.pre('updateOne', blockMutation);
subscriptionHistorySchema.pre('updateMany', blockMutation);
subscriptionHistorySchema.pre('findOneAndUpdate', blockMutation);
subscriptionHistorySchema.pre('replaceOne', blockMutation);
subscriptionHistorySchema.pre('findOneAndReplace', blockMutation);
subscriptionHistorySchema.pre('deleteOne', blockMutation);
subscriptionHistorySchema.pre('deleteMany', blockMutation);
subscriptionHistorySchema.pre('findOneAndDelete', blockMutation);

const SubscriptionHistory = mongoose.model('SubscriptionHistory', subscriptionHistorySchema);

export default SubscriptionHistory;
