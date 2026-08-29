import mongoose from 'mongoose';

const { Schema } = mongoose;

const payoutSchema = new Schema(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bookingIds: [{ type: Schema.Types.ObjectId, ref: 'Booking', required: true }],
    amount: { type: Number, required: true, min: 0 },
    grossAmount: { type: Number, min: 0 },
    deductions: [
      {
        penaltyId: { type: Schema.Types.ObjectId, ref: 'Penalty' },
        amountMinor: { type: Number, min: 0 },
        reasonType: String,
      },
    ],
    currency: { type: String, default: 'EGP' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed'],
      default: 'pending',
    },
    method: {
      type: String,
      enum: ['bank_transfer', 'vodafone_cash', 'instapay'],
      required: true,
    },
    payoutAccountDetails: {
      accountHolderName: String,
      bankName: String,
      accountNumber: String,
      walletPhone: String,
    },
    reference: { type: String, trim: true },
    failureReason: { type: String, trim: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    processedAt: Date,
    paidAt: Date,
  },
  { timestamps: true }
);

payoutSchema.index({ stylistId: 1, createdAt: -1 });
payoutSchema.index({ status: 1 });

const Payout = mongoose.model('Payout', payoutSchema);
export default Payout;
