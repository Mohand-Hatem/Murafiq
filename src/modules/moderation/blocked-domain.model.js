import mongoose from 'mongoose';

const { Schema } = mongoose;

const blockedDomainSchema = new Schema(
  {
    domain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      default: 'external_communication',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

const BlockedDomain = mongoose.model('BlockedDomain', blockedDomainSchema);

export default BlockedDomain;
