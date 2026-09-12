import Booking from '../src/modules/bookings/booking.model.js';
import Payout from '../src/modules/payouts/payout.model.js';
import { connectDB } from '../src/database/connection.js';
import mongoose from 'mongoose';

/**
 * Migration S3.3: Backfill payoutStatus: 'paid' -> 'not_owed' for stylist no-shows.
 *
 * Narrow ON PURPOSE: 'paid' means "disbursed" for every booking that reached a real
 * Payout batch, and "nothing owed" only for a settled stylist no-show that never did.
 * The absence of a payoutId is what distinguishes them.
 */
export const migrateS3PayoutStatus = async ({ isApply = false } = {}) => {
  const filter = {
    status: 'no-show-stylist',
    payoutStatus: 'paid',
    $or: [{ payoutId: null }, { payoutId: { $exists: false } }],
  };

  const matched = await Booking.find(filter).select('_id');
  const matchedIds = matched.map((b) => b._id);

  console.log(`[migrate-s3-payout-status] Found ${matchedIds.length} candidate booking(s).`);

  if (matchedIds.length > 0) {
    const inRealPayout = await Payout.countDocuments({ bookingIds: { $in: matchedIds } });
    if (inRealPayout > 0) {
      throw new Error(
        `[SAFETY ABORT] ${inRealPayout} candidate booking(s) appear in real Payout batches! Aborting.`
      );
    }
  }

  if (!isApply) {
    console.log('[migrate-s3-payout-status] DRY RUN complete. Pass --apply to execute migration.');
    return { matchedCount: matchedIds.length, modifiedCount: 0, applied: false };
  }

  const result = await Booking.updateMany(filter, { $set: { payoutStatus: 'not_owed' } });
  console.log(`[migrate-s3-payout-status] Updated ${result.modifiedCount} booking(s) to 'not_owed'.`);
  return { matchedCount: matchedIds.length, modifiedCount: result.modifiedCount, applied: true };
};

if (process.argv[1] && process.argv[1].endsWith('migrate-s3-payout-status.js')) {
  const isApply = process.argv.includes('--apply');
  await connectDB();
  try {
    await migrateS3PayoutStatus({ isApply });
    process.exit(0);
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

export default migrateS3PayoutStatus;
