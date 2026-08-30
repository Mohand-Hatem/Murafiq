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
    otpAttempts: { type: Number, default: 0, select: false },
    accountStatus: { type: String, enum: Object.values(ACCOUNT_STATUS), default: ACCOUNT_STATUS.ACTIVE },

    // Global credential-invalidation stamp, embedded in every access token as `tv` and
    // checked on every request. Bumped only when ALL previously issued credentials must
    // die at once: password reset/change, logout-all, admin revocation, suspension,
    // blocking, and moderation enforcement. NOT bumped by ordinary single-device logout.
    tokenVersion: { type: Number, default: 0 },

    // One entry per signed-in device. Replaces the previous single `refreshTokenHash`
    // scalar, which allowed only one session per user — a mobile login silently killed
    // the web session. (That field was also missing from this schema entirely, so
    // Mongoose strict mode discarded every write to it and refresh was fully broken.)
    //
    // `select: false`: these are credentials. They must never ride along on an ordinary
    // user read, and no DTO exposes them.
    sessions: {
      type: [
        new Schema(
          {
            // SHA-256, NOT bcrypt. Refresh tokens are high-entropy signed JWTs, so the
            // slow salted hashing that protects low-entropy passwords buys nothing here
            // — and a salted hash cannot be matched by equality, which would make the
            // atomic single-round-trip rotation below impossible.
            tokenHash: { type: String, required: true },
            deviceLabel: { type: String, trim: true, default: 'Unknown device' },
            createdAt: { type: Date, default: Date.now },
            lastUsedAt: { type: Date, default: Date.now },
            expiresAt: { type: Date, required: true },
          },
          { _id: true }
        ),
      ],
      default: [],
      select: false,
    },
    chatRestrictedUntil: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    // Profile fields (Phase 2)
    profileImage: { type: String, default: DEFAULT_PROFILE_IMAGE_URL },
    gender: { type: String, enum: ['male', 'female'] },
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
