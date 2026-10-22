import mongoose from 'mongoose';
import Booking from '../src/modules/bookings/booking.model.js';
import { connectDB } from '../src/database/connection.js';

/**
 * Pay-before-confirm migration. Idempotent.
 *
 * `Booking.requestId` and `Booking.offerId` were unique across ALL bookings. A released unpaid
 * booking must not block re-booking the reopened request, so both are now unique only among live
 * bookings (`isLive: true`). Mongoose cannot alter an existing index, so this script:
 *   1. backfills isLive:true on every existing booking (same semantics as before for old data),
 *   2. drops the old non-partial unique indexes,
 *   3. builds the new partial ones.
 * Run once per database BEFORE deploying: `node scripts/migrate-booking-live-indexes.js`.
 */
const migrateBookingLiveIndexes = async () => {
  await connectDB();
  const col = Booking.collection;

  const backfill = await col.updateMany({ isLive: { $exists: false } }, { $set: { isLive: true } });
  console.log(`Backfilled isLive on ${backfill.modifiedCount} booking(s).`);

  for (const index of await col.indexes()) {
    const isTarget = ['offerId_1', 'requestId_1'].includes(index.name);
    if (isTarget && !index.partialFilterExpression) {
      await col.dropIndex(index.name);
      console.log(`Dropped non-partial index ${index.name}.`);
    }
  }

  await Booking.createIndexes(); // add-only: never drops indexes the schema does not declare
  console.log('Booking indexes ensured (offerId/requestId unique where isLive:true).');
};

migrateBookingLiveIndexes()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
