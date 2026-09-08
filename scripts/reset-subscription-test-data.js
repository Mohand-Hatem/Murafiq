import mongoose from 'mongoose';
import Subscription from '../src/modules/subscriptions/subscription.model.js';
import SubscriptionOrder from '../src/modules/subscriptions/subscription-order.model.js';
import LedgerEntry from '../src/modules/ledger/ledger-entry.model.js';
import { connectDB } from '../src/database/connection.js';
import env from '../src/config/env.config.js';

/**
 * Clears the residue left by the old `POST /subscriptions/subscribe` free-grant hole:
 * subscriptions on paid plans that nobody paid for, the pending checkout orders from testing,
 * and the ledger entries those grants minted for money that was never collected.
 *
 * DEVELOPMENT / TEST ONLY. This deletes ledger rows, which breaks the append-only invariant
 * the LedgerEntry model enforces with pre-hooks. On a database that has ever held real money
 * the correct repair is an offsetting ADJUSTMENT entry, never a delete -- so the production
 * guard below is load-bearing, not ceremony.
 *
 * Idempotent: a second run finds nothing to do.
 */

// Only subscription money is ever in scope. Booking payments, escrow, payouts and penalties
// share these entryTypes' collection, so the idempotencyKey prefix -- not the type -- is what
// keeps this from touching a single EGP of real booking money.
const SUBSCRIPTION_LEDGER_KEY = /^subscription:(charge|platform):/;

const freePlanFor = (role) => (role === 'stylist' ? 'stylist.free' : 'client.free');

export const resetSubscriptionTestData = async () => {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'reset-subscription-test-data is forbidden in production: it deletes immutable ledger entries. ' +
        'Repair production books with offsetting ADJUSTMENT entries instead.'
    );
  }

  console.log(`Connecting to database (NODE_ENV=${env.NODE_ENV})...`);
  await connectDB();

  const summary = { reverted: 0, periodsNormalized: 0, ordersDeleted: 0, ledgerDeleted: 0 };

  // 1. Revert paid plans that no payment ever backed. A genuinely purchased subscription
  //    always carries the provider reference the webhook wrote, so its absence -- not the
  //    plan code -- is the safe signal, and a legitimately paid row is never touched.
  const unpaid = await Subscription.find({
    planCode: { $not: /\.free$/ },
    $or: [{ paymobSubscriptionId: null }, { paymobSubscriptionId: { $exists: false } }],
  }).lean();

  for (const sub of unpaid) {
    await Subscription.updateOne(
      { _id: sub._id },
      {
        $set: {
          planCode: freePlanFor(sub.role),
          billingCycle: 'monthly',
          currentPeriodStart: new Date(),
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pendingPlanCode: null,
          pendingBillingCycle: null,
        },
      }
    );
    console.log(`   reverted ${sub.planCode} -> ${freePlanFor(sub.role)} (user ${sub.userId})`);
    summary.reverted += 1;
  }

  // 2. A free tier never expires. A non-null currentPeriodEnd on one is simply wrong state,
  //    and it makes the nightly renewal sweep re-scan the row forever for no reason.
  const normalized = await Subscription.updateMany(
    { planCode: /\.free$/, currentPeriodEnd: { $ne: null } },
    { $set: { currentPeriodEnd: null } }
  );
  summary.periodsNormalized = normalized.modifiedCount || 0;

  // 3. Abandoned checkout attempts. Only 'pending' -- a paid order is a real receipt.
  const orders = await SubscriptionOrder.deleteMany({ status: 'pending' });
  summary.ordersDeleted = orders.deletedCount || 0;

  // 4. The fabricated revenue. Native driver on purpose: the model's pre('deleteMany') hook
  //    throws to keep the ledger append-only, and going around it is exactly the thing this
  //    script is not allowed to do in production.
  const ledger = await LedgerEntry.collection.deleteMany({
    idempotencyKey: { $regex: SUBSCRIPTION_LEDGER_KEY },
  });
  summary.ledgerDeleted = ledger.deletedCount || 0;

  console.log('');
  console.log(`✅ Subscriptions reverted to free (unpaid grants) : ${summary.reverted}`);
  console.log(`✅ Free-tier period dates normalized to null      : ${summary.periodsNormalized}`);
  console.log(`✅ Pending checkout orders deleted                : ${summary.ordersDeleted}`);
  console.log(`✅ Fabricated subscription ledger entries deleted : ${summary.ledgerDeleted}`);

  return summary;
};

if (process.argv[1] && process.argv[1].endsWith('reset-subscription-test-data.js')) {
  resetSubscriptionTestData()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`❌ Reset failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

export default resetSubscriptionTestData;
