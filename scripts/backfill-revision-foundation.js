import Request from '../src/modules/requests/request.model.js';
import Offer from '../src/modules/offers/offer.model.js';
import Booking from '../src/modules/bookings/booking.model.js';
import User from '../src/modules/users/user.model.js';
import StylistProfile from '../src/modules/stylists/stylist-profile.model.js';
import Payment from '../src/modules/payments/payment.model.js';
import AuditLog from '../src/modules/audit-log/audit-log.model.js';
import Plan from '../src/modules/subscriptions/plan.model.js';
import Subscription from '../src/modules/subscriptions/subscription.model.js';
import UsageCounter from '../src/modules/subscriptions/usage-counter.model.js';
import LedgerEntry from '../src/modules/ledger/ledger-entry.model.js';
import Penalty from '../src/modules/penalties/penalty.model.js';
import Coupon from '../src/modules/coupons/coupon.model.js';
import ModerationEvent from '../src/modules/moderation/moderation-event.model.js';
import PolicyViolation from '../src/modules/moderation/policy-violation.model.js';
import BlockedDomain from '../src/modules/moderation/blocked-domain.model.js';
import ReliabilityEvent from '../src/modules/reliability/reliability-event.model.js';
import { connectDB } from '../src/database/connection.js';

export const backfillRevisionFoundation = async () => {
  console.log('Connecting to database for Revision Foundation backfill...');
  await connectDB();

  try {
    // 1. Backfill User tokenVersion
    const userRes = await User.updateMany(
      { tokenVersion: { $exists: false } },
      { $set: { tokenVersion: 0 } }
    );
    console.log(`✅ Backfilled ${userRes.modifiedCount} User documents with tokenVersion=0.`);

    // 2. Backfill StylistProfile reliability fields
    const stylistRes = await StylistProfile.updateMany(
      { reliabilityScore: { $exists: false } },
      {
        $set: {
          reliabilityScore: 100,
          reliabilityTier: 'standard',
          noShowCount: 0,
          lateCancelCount: 0,
        },
      }
    );
    console.log(`✅ Backfilled ${stylistRes.modifiedCount} StylistProfile documents with reliability defaults.`);

    // 3. Backfill Booking isFrozen
    const bookingRes = await Booking.updateMany(
      { isFrozen: { $exists: false } },
      { $set: { isFrozen: false } }
    );
    console.log(`✅ Backfilled ${bookingRes.modifiedCount} Booking documents with isFrozen=false.`);

    // 3b. STATUS MIGRATION — the step that lets the enums be narrowed.
    //
    // Runs through `.collection` (the raw driver) on purpose: the Mongoose enums have
    // already been narrowed to the new values, so any model-level write touching a
    // legacy document would fail validation before it could be migrated. The raw
    // driver bypasses that, which is exactly what a data migration needs.
    //
    // Every mapping below is idempotent — re-running matches nothing on a second pass.
    const REQUEST_STATUS_MAP = {
      pending: 'OPEN',
      offered: 'OPEN', // 'offered' is deleted as a status; it is now Request.offerCount
      accepted: 'FULFILLED',
      rejected: 'DECLINED',
      expired: 'PAUSED', // was terminal, is now reactivatable — the §8 rule
      cancelled: 'CANCELLED',
    };
    let reqStatusMigrated = 0;
    for (const [legacy, next] of Object.entries(REQUEST_STATUS_MAP)) {
      const res = await Request.collection.updateMany(
        { status: legacy },
        { $set: { status: next } }
      );
      reqStatusMigrated += res.modifiedCount;
    }
    console.log(`✅ Migrated ${reqStatusMigrated} Request status values to the new lifecycle.`);

    // Offer 'rejected' is ambiguous and must be disambiguated per request, not in bulk:
    // a losing bid on a request that someone else won is CLOSED (nobody judged it),
    // whereas a bid the client explicitly declined is REJECTED. Conflating them would
    // permanently corrupt any future acceptance-rate metric for stylists.
    const legacyRejected = await Offer.collection
      .find({ status: 'rejected' }, { projection: { requestId: 1 } })
      .toArray();
    let closedCount = 0;
    let rejectedCount = 0;
    for (const off of legacyRejected) {
      const winner = await Offer.collection.findOne({
        requestId: off.requestId,
        status: { $in: ['accepted', 'ACCEPTED'] },
      });
      const next = winner ? 'CLOSED' : 'REJECTED';
      await Offer.collection.updateOne({ _id: off._id }, { $set: { status: next } });
      if (winner) closedCount += 1;
      else rejectedCount += 1;
    }
    console.log(
      `✅ Disambiguated ${legacyRejected.length} legacy 'rejected' offers → ${closedCount} CLOSED (a sibling won), ${rejectedCount} REJECTED (client declined).`
    );

    const OFFER_STATUS_MAP = {
      pending: 'PENDING',
      accepted: 'ACCEPTED',
      expired: 'EXPIRED',
      withdrawn: 'WITHDRAWN',
    };
    let offStatusMigrated = 0;
    for (const [legacy, next] of Object.entries(OFFER_STATUS_MAP)) {
      const res = await Offer.collection.updateMany({ status: legacy }, { $set: { status: next } });
      offStatusMigrated += res.modifiedCount;
    }
    console.log(`✅ Migrated ${offStatusMigrated} Offer status values to the new lifecycle.`);

    // Booking keeps lowercase-hyphen values; fold away the uppercase duplicates that
    // were briefly present in the enum so only one form can exist in the data.
    const bookingStatusRes = await Booking.collection.updateMany(
      { status: 'NO_SHOW_STYLIST' },
      { $set: { status: 'no-show-stylist' } }
    );
    const bookingStatusRes2 = await Booking.collection.updateMany(
      { status: 'NO_SHOW_CLIENT' },
      { $set: { status: 'no-show-client' } }
    );
    console.log(
      `✅ Normalised ${bookingStatusRes.modifiedCount + bookingStatusRes2.modifiedCount} Booking no-show status values.`
    );

    // Guard: nothing may survive outside the new enums, or the app will throw on the
    // first write to that document. Fail loudly here rather than in production.
    const strayRequests = await Request.collection.countDocuments({
      status: { $nin: ['OPEN', 'PAUSED', 'CLOSED', 'FULFILLED', 'CANCELLED', 'DECLINED'] },
    });
    const strayOffers = await Offer.collection.countDocuments({
      status: { $nin: ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'EXPIRED'] },
    });
    if (strayRequests > 0 || strayOffers > 0) {
      throw new Error(
        `Status migration incomplete: ${strayRequests} Request(s) and ${strayOffers} Offer(s) still hold values outside the new enums. Investigate before deploying — do not narrow the enums until this reports 0.`
      );
    }
    console.log('✅ Verified: no Request or Offer holds a status outside the new enums.');

    // 4. Backfill Request lifecycle fields (offerCount, firstOfferAt, autoPauseAt, pauseCount)
    //
    // Read through `.collection` rather than the model. Mongoose applies schema defaults
    // during hydration, so `Request.find()` reports `offerCount: 0` and `pauseCount: 0`
    // for documents where the field is genuinely absent in the database — an
    // `=== undefined` check against a hydrated doc can therefore never be true, and the
    // backfill silently does nothing. That is exactly what happened on the first pass:
    // it reported success while leaving offerCount unset, which would have made the
    // auto-pause sweep (`offerCount: { $lte: 0 }`) pause requests that had live offers.
    const rawRequests = await Request.collection.find({}).toArray();
    let reqUpdated = 0;
    for (const req of rawRequests) {
      const updateDoc = {};

      if (req.autoPauseAt === undefined) {
        const created = req.createdAt ? new Date(req.createdAt) : new Date();
        updateDoc.autoPauseAt = req.expiresAt || new Date(created.getTime() + 48 * 60 * 60 * 1000);
      }
      if (req.pauseCount === undefined) {
        updateDoc.pauseCount = 0;
      }

      // Always recomputed from the offers themselves rather than trusted from the
      // document — this is the field the whole edit-immutability and auto-pause
      // behaviour keys off, so a stale value is worse than a missing one.
      const count = await Offer.collection.countDocuments({ requestId: req._id });
      if (req.offerCount !== count) {
        updateDoc.offerCount = count;
      }
      if (count > 0 && !req.firstOfferAt) {
        const [earliest] = await Offer.collection
          .find({ requestId: req._id })
          .sort({ createdAt: 1 })
          .limit(1)
          .toArray();
        if (earliest?.createdAt) {
          updateDoc.firstOfferAt = earliest.createdAt;
        }
      }

      if (Object.keys(updateDoc).length > 0) {
        await Request.collection.updateOne({ _id: req._id }, { $set: updateDoc });
        reqUpdated += 1;
      }
    }
    console.log(`✅ Backfilled ${reqUpdated} Request documents with lifecycle metadata.`);

    // Guard: offerCount drives auto-pause and edit-immutability, so prove it matches
    // reality on every request before declaring the migration done.
    const mismatches = [];
    for (const req of await Request.collection.find({}).toArray()) {
      const actual = await Offer.collection.countDocuments({ requestId: req._id });
      if ((req.offerCount ?? 0) !== actual) {
        mismatches.push(`${req._id}: offerCount=${req.offerCount} actual=${actual}`);
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `offerCount backfill incomplete on ${mismatches.length} request(s): ${mismatches.slice(0, 5).join('; ')}`
      );
    }
    console.log('✅ Verified: Request.offerCount matches the real offer count on every request.');

    // 5. Drop legacy unique index on Offer collection if present
    try {
      await Offer.collection.dropIndex('requestId_1_stylistId_1');
      console.log('✅ Dropped legacy unique index requestId_1_stylistId_1 on Offer.');
    } catch {
      console.log('ℹ️ Legacy unique index requestId_1_stylistId_1 already dropped or not present.');
    }

    // 6. Synchronize all model indexes
    console.log('Synchronizing model indexes...');
    await Request.syncIndexes();
    await Offer.syncIndexes();
    await Booking.syncIndexes();
    await Payment.syncIndexes();
    await User.syncIndexes();
    await StylistProfile.syncIndexes();
    await AuditLog.syncIndexes();
    await Plan.syncIndexes();
    await Subscription.syncIndexes();
    await UsageCounter.syncIndexes();
    await LedgerEntry.syncIndexes();
    await Penalty.syncIndexes();
    await Coupon.syncIndexes();
    await ModerationEvent.syncIndexes();
    await PolicyViolation.syncIndexes();
    await BlockedDomain.syncIndexes();
    await ReliabilityEvent.syncIndexes();
    console.log('✅ All model indexes synchronized successfully.');
  } catch (error) {
    console.error(`❌ Migration backfill failed: ${error.message}`);
    throw error;
  }
};

if (process.argv[1] && process.argv[1].endsWith('backfill-revision-foundation.js')) {
  backfillRevisionFoundation()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default backfillRevisionFoundation;
