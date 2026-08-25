import Request from '../src/modules/requests/request.model.js';
import Offer from '../src/modules/offers/offer.model.js';
import Booking from '../src/modules/bookings/booking.model.js';
import { connectDB } from '../src/database/connection.js';

export const backfillBroadcastVisibility = async () => {
  console.log('Connecting to database for broadcast visibility backfill...');
  await connectDB();

  try {
    const reqRes = await Request.updateMany(
      { visibility: { $exists: false } },
      { $set: { visibility: 'direct' } }
    );
    console.log(`✅ Backfilled ${reqRes.modifiedCount} Request documents to visibility='direct'.`);

    const offerRes = await Offer.updateMany(
      { requestVisibility: { $exists: false } },
      { $set: { requestVisibility: 'direct' } }
    );
    console.log(`✅ Backfilled ${offerRes.modifiedCount} Offer documents to requestVisibility='direct'.`);

    console.log('Building model indexes...');
    await Request.syncIndexes();
    await Offer.syncIndexes();
    // Booking's new unique index on {requestId} — omitted here originally; autoIndex:true means
    // it would build automatically on next server start regardless, but syncing it explicitly here
    // means an E11000 (unexpected duplicate requestId in existing data) surfaces during this
    // deliberate migration step instead of silently at the next app boot.
    await Booking.syncIndexes();
    console.log('✅ Indexes synchronized successfully.');
  } catch (error) {
    console.error(`❌ Migration backfill failed: ${error.message}`);
    throw error;
  }
};

if (process.argv[1] && process.argv[1].endsWith('backfill-broadcast-visibility.js')) {
  backfillBroadcastVisibility()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default backfillBroadcastVisibility;
