import mongoose from 'mongoose';

const { Schema } = mongoose;

const scheduleBlockSchema = new Schema(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    date: { type: Date, required: true },
    startMinute: { type: Number, required: true }, // integer minutes since midnight
    endMinute: { type: Number, required: true },   // integer minutes since midnight
  },
  { timestamps: true }
);

scheduleBlockSchema.index({ stylistId: 1, date: 1 });
scheduleBlockSchema.index({ bookingId: 1 });

const ScheduleBlock = mongoose.model('ScheduleBlock', scheduleBlockSchema);

export default ScheduleBlock;
