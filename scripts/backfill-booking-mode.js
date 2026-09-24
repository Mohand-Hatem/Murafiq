import mongoose from 'mongoose';
import Booking from '../src/modules/bookings/booking.model.js';
import { connectDB } from '../src/database/connection.js';

export const backfillBookingMode = async () => {
  console.log('Connecting to database for bookingMode backfill...');
  await connectDB();

  try {
    const bookingRes = await Booking.updateMany(
      { bookingMode: { $exists: false } },
      { $set: { bookingMode: 'standard' } }
    );
    console.log(`✅ Backfilled ${bookingRes.modifiedCount} Booking documents to bookingMode='standard'.`);

    console.log('Building model indexes...');
    await Booking.syncIndexes();
    console.log('✅ Indexes synchronized successfully.');
    return bookingRes;
  } catch (error) {
    console.error(`❌ Migration backfill failed: ${error.message}`);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
};

if (process.argv[1] && process.argv[1].endsWith('backfill-booking-mode.js')) {
  backfillBookingMode()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default backfillBookingMode;
