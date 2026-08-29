import mongoose from 'mongoose';

const { Schema } = mongoose;

const ledgerEntrySchema = new Schema(
  {
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    entryType: {
      type: String,
      // Keep in sync with spec §G.1. A value used in code but absent here fails schema
      // validation, and because ledger writes are wrapped in try/catch the failure is
      // SILENT — and if a paired debit/credit share one try block, the first failure
      // suppresses its partner too, so reconciliation stays balanced and never alerts.
      enum: [
        'PAYMENT',
        'ESCROW_HOLD',
        'ESCROW_RELEASE',
        'REFUND',
        'PLATFORM_FEE',
        'PENALTY_ASSESSMENT',
        'PENALTY_SETTLEMENT',
        'PAYOUT_DISBURSEMENT',
        'SUBSCRIPTION_PAYMENT',
        'COUPON_DISCOUNT',
        'ADJUSTMENT',
      ],
      required: true,
      index: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      index: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      index: true,
    },
    payoutId: {
      type: Schema.Types.ObjectId,
      ref: 'Payout',
      index: true,
    },
    accountType: {
      type: String,
      enum: ['PLATFORM', 'CLIENT', 'STYLIST', 'ESCROW'],
      required: true,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    amountMinor: {
      type: Number, // Integer piastres (e.g. 1000 EGP = 100000 piastres)
      required: true,
    },
    currency: {
      type: String,
      default: 'EGP',
    },
    direction: {
      type: String,
      enum: ['DEBIT', 'CREDIT'],
      required: true,
    },
    correlationId: {
      type: String,
      index: true,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ledgerEntrySchema.index({ accountId: 1, createdAt: -1 });
ledgerEntrySchema.index({ bookingId: 1, entryType: 1 });

const blockMutation = function () {
  throw new Error('Ledger entries are immutable and cannot be modified or deleted.');
};

ledgerEntrySchema.pre('updateOne', blockMutation);
ledgerEntrySchema.pre('updateMany', blockMutation);
ledgerEntrySchema.pre('findOneAndUpdate', blockMutation);
ledgerEntrySchema.pre('replaceOne', blockMutation);
ledgerEntrySchema.pre('findOneAndReplace', blockMutation);
ledgerEntrySchema.pre('deleteOne', blockMutation);
ledgerEntrySchema.pre('deleteMany', blockMutation);
ledgerEntrySchema.pre('findOneAndDelete', blockMutation);

const LedgerEntry = mongoose.model('LedgerEntry', ledgerEntrySchema);

export default LedgerEntry;
