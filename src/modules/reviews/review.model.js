import mongoose, { Schema } from 'mongoose';

export const REVIEW_DIRECTIONS = ['client_to_stylist', 'stylist_to_client'];

const reviewSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    raterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    revieweeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: REVIEW_DIRECTIONS,
      required: true,
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    isHidden: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// One review per party per booking enforced at database engine level
reviewSchema.index({ bookingId: 1, direction: 1 }, { unique: true });

// Compound index for aggregation performance and public queries
reviewSchema.index({ revieweeId: 1, direction: 1, isHidden: 1 });

const Review = mongoose.model('Review', reviewSchema);

export default Review;
