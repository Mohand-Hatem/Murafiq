import Plan from '../src/modules/subscriptions/plan.model.js';
import Subscription from '../src/modules/subscriptions/subscription.model.js';
import SubscriptionOrder from '../src/modules/subscriptions/subscription-order.model.js';
import { CANONICAL_PLANS } from '../src/modules/subscriptions/plan.constants.js';
import { connectDB } from '../src/database/connection.js';

const LEGACY_YEARLY_CODE = /\.yearly$/;

/**
 * Migrates rows created under the old catalogue shape, where a yearly plan was a SEPARATE
 * plan code (`client.pro.yearly`) rather than a yearly price on its monthly parent.
 *
 * Idempotent and re-runnable: it matches only codes still carrying the `.yearly` suffix,
 * so a second run finds nothing to do.
 */
const migrateLegacyYearlyCodes = async () => {
  const summary = { plansDeactivated: 0, subscriptions: 0, orders: 0 };

  // Deactivate rather than delete: an old row is evidence of what a user was sold, and
  // findActiveByRole/findAllActive already filter on isActive, so it leaves the catalogue.
  const deactivated = await Plan.updateMany(
    { code: LEGACY_YEARLY_CODE, isActive: true },
    { $set: { isActive: false } }
  );
  summary.plansDeactivated = deactivated.modifiedCount || 0;

  // Remap live references onto the parent code + an explicit yearly cycle. Without this a
  // subscriber on `client.pro.yearly` would resolve to no plan at all once it is inactive,
  // and silently fall back to Free entitlements.
  for (const Model of [Subscription, SubscriptionOrder]) {
    const rows = await Model.find({ planCode: LEGACY_YEARLY_CODE }).lean();
    for (const row of rows) {
      await Model.updateOne(
        { _id: row._id },
        { $set: { planCode: row.planCode.replace(LEGACY_YEARLY_CODE, ''), billingCycle: 'yearly' } }
      );
    }
    if (Model === Subscription) summary.subscriptions = rows.length;
    else summary.orders = rows.length;
  }

  return summary;
};

export const seedPlans = async () => {
  console.log('Connecting to database for Plan catalogue seeding...');
  await connectDB();

  try {
    let seededCount = 0;
    for (const plan of CANONICAL_PLANS) {
      await Plan.findOneAndUpdate(
        { code: plan.code },
        { $set: plan },
        { upsert: true, returnDocument: 'after' }
      );
      seededCount++;
    }

    // Drop the retired `billingCycle` field via the NATIVE driver. It cannot go through
    // Mongoose: the path no longer exists on the schema, and strict mode silently strips an
    // $unset for an unknown path -- the update reports success and changes nothing. (Same
    // silent-drop that once discarded every Payment.refundedAt.) Removing it matters because
    // a stale per-plan cycle is exactly the second source of truth this migration exists to
    // eliminate: a row claiming `billingCycle: 'monthly'` while carrying a yearly price is a
    // trap for the next reader.
    const unsetResult = await Plan.collection.updateMany(
      { billingCycle: { $exists: true } },
      { $unset: { billingCycle: '' } }
    );

    const migration = await migrateLegacyYearlyCodes();

    console.log(`✅ Successfully seeded ${seededCount} canonical Plans into catalogue.`);
    if (unsetResult.modifiedCount > 0) {
      console.log(`✅ Removed the retired billingCycle field from ${unsetResult.modifiedCount} plan(s).`);
    }
    if (migration.plansDeactivated || migration.subscriptions || migration.orders) {
      console.log(
        `✅ Legacy .yearly migration: deactivated ${migration.plansDeactivated} plan(s), ` +
          `remapped ${migration.subscriptions} subscription(s) and ${migration.orders} order(s).`
      );
    } else {
      console.log('✅ Legacy .yearly migration: nothing to migrate.');
    }
  } catch (error) {
    console.error(`❌ Plan seeding failed: ${error.message}`);
    throw error;
  }
};

if (process.argv[1] && process.argv[1].endsWith('seed-plans.js')) {
  seedPlans()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default seedPlans;
