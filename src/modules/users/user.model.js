import mongoose from 'mongoose';
import { ROLES } from '../../common/constants/roles.constant.js';
import { ACCOUNT_STATUS } from '../../common/constants/statuses.constant.js';
import { DEFAULT_PROFILE_IMAGE_URL } from '../../common/constants/defaults.constant.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, unique: true, required: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true, trim: true },
    // Required unless this is a Google-only account (no local password ever set).
    passwordHash: {
      type: String,
      required: function passwordRequiredUnlessGoogleAccount() {
        return !this.googleId;
      },
      select: false,
    },
    // Sparse — most accounts won't have one. Set on creation for a Google-first signup, or
    // attached later if a Google sign-in auto-links to an existing local-password account.
    googleId: { type: String, unique: true, sparse: true },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.CLIENT },
    isEmailVerified: { type: Boolean, default: false },
    otpCode: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
    refreshTokenHash: { type: String, select: false },
    accountStatus: { type: String, enum: Object.values(ACCOUNT_STATUS), default: ACCOUNT_STATUS.ACTIVE },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    // Profile fields (Phase 2)
    profileImage: { type: String, default: DEFAULT_PROFILE_IMAGE_URL },
    country: String,
    governorate: String,
    city: String,
    area: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // Verification fields (Phase 2)
    verification: {
      status: {
        type: String,
        enum: ['unverified', 'pending', 'verified', 'rejected'],
        default: 'unverified',
      },
      documents: [
        {
          type: {
            type: String,
            enum: [
              'national_id_front',
              'national_id_back',
              'selfie_with_id',
              'police_clearance_certificate',
            ],
          },
          url: String,
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      rejectionReason: String,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
    },

    isOnline: { type: Boolean, default: false },
    fcmTokens: { type: [String], default: [] },
    clientRating: { type: Number, default: 0 },
    clientTotalReviews: { type: Number, default: 0 },
    completedBookings: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.index({ location: '2dsphere' });

// Soft-deleted users never appear in normal queries.
userSchema.pre(/^find/, function excludeSoftDeleted() {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: { $ne: true } });
  }
});

const User = mongoose.model('User', userSchema);

export default User;
