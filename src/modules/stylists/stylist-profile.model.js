import mongoose from 'mongoose';

const { Schema } = mongoose;

const stylistProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    specialty: { type: String, enum: ['stylist', 'personal_shopper'], required: true },
    bio: { type: String, trim: true },
    serviceDescription: { type: String, trim: true },
    experienceYears: { type: Number, default: 0 },
    languages: [{ type: String, trim: true }],
    services: [{ type: String, trim: true }],
    // Minimum 100 EGP hourly rate floor
    hourlyPrice: { type: Number, min: 100, required: true },
    portfolio: [{ type: String, trim: true }],
    workingAreas: [{ type: String, trim: true }],
    weeklyAvailability: [
      {
        day: { type: String, enum: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] },
        startTime: { type: String, trim: true }, // "10:00"
        endTime: { type: String, trim: true },   // "18:00"
      },
    ],
    rating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    completedSessions: { type: Number, default: 0 },
    gender: { type: String, enum: ['male', 'female'] },

    // Denormalized read-copy of User location fields for fast search
    country: { type: String, trim: true },
    governorate: { type: String, trim: true },
    city: { type: String, trim: true },
    area: { type: String, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },
    locationSet: { type: Boolean, default: false },
  },
  { timestamps: true }
);

stylistProfileSchema.index({ location: '2dsphere' });

const StylistProfile = mongoose.model('StylistProfile', stylistProfileSchema);

export default StylistProfile;
