import mongoose from 'mongoose';
import { ROLES } from '../../common/constants/roles.constant.js';
import { ACCOUNT_STATUS } from '../../common/constants/statuses.constant.js';

const { Schema } = mongoose;

// Role → default Arabic display name mapping, used when a user doesn't supply nameAr at registration.
const ROLE_AR_DEFAULTS = {
  [ROLES.CLIENT]: 'مستخدم',
  [ROLES.STYLIST]: 'مصمم',
  [ROLES.ADMIN]: 'ادمن',
};

const userSchema = new Schema(
  {
    nameEn: { type: String, required: true, trim: true },
    nameAr: { type: String, trim: true },
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
  },
  { timestamps: true }
);

// Auto-fill nameAr from role if the user didn't provide one; stays in sync if role changes before save.
userSchema.pre('save', function assignDefaultArabicName(next) {
  if (!this.nameAr) {
    this.nameAr = ROLE_AR_DEFAULTS[this.role] || 'مستخدم';
  }
  next();
});

// Soft-deleted users never appear in normal queries.
userSchema.pre(/^find/, function excludeSoftDeleted(next) {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: { $ne: true } });
  }
  next();
});

const User = mongoose.model('User', userSchema);

export default User;
