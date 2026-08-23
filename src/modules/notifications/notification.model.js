import mongoose, { Schema } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'request',      // Phase 4 — new request sent to stylist
  'offer',        // Phase 4 — new offer received by client
  'booking',      // Phase 5 — booking confirmed
  'payment',      // Phase 6 — payment succeeded/failed/refunded
  'message',      // Phase 7 — new chat message
  'reminder',     // Phase 12 — session reminder job
  'review',       // Phase 8 — new review received
  'verification', // Phase 2 — ID verification approved/rejected
  'safety',       // Phase 11 — SOS alert, safety report update
  'payout',       // Phase 11 — payout status change
  'system',       // catch-all for admin/platform messages
];

const notificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    relatedEntityId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
