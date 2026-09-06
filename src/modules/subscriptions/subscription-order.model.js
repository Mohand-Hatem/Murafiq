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
      enum: ['pending', 'paid', 'failed'],
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
