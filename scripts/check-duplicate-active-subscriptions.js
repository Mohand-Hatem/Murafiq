import subscriptionRepository from '../src/modules/subscriptions/subscription.repository.js';
import { connectDB } from '../src/database/connection.js';

/**
 * Pre-flight for the partial unique index on Subscription { userId } where status:'active'.
 *
 * Building that index fails outright if any user already holds two active rows, and Mongo's
 * failure message names only one offending key -- not every user who needs fixing. Run this
 * first on any database that predates the index.
 *
 * STRICTLY READ-ONLY. It deletes and merges nothing: choosing which of two active rows to keep
 * depends on which plan the user actually paid for, which is a judgement call that belongs to a
 * human looking at the matching SubscriptionOrder records, not to a migration script.
 *
 * Exit code 0 = clean (safe to build the index), 1 = duplicates found or the check failed.
 */
export const checkDuplicateActiveSubscriptions = async () => {
  console.log('Connecting to database to check for duplicate active subscriptions...');
  await connectDB();

  const duplicates = await subscriptionRepository.findDuplicateActiveSubscriptions();

  if (duplicates.length === 0) {
    console.log('✅ No duplicate active subscriptions found — safe to build the unique index.');
    return { clean: true, duplicates };
  }

  console.error(
    `❌ ${duplicates.length} user(s) hold more than one active subscription. ` +
      'Resolve these before building the index:\n'
  );

  for (const row of duplicates) {
    console.error(`  user ${row.userId} — ${row.count} active rows:`);
    for (const sub of row.subscriptions) {
      const end = sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : 'never (free)';
      console.error(
        `    ${sub._id}  plan=${sub.planCode}  source=${sub.source || 'unknown'}  ` +
          `start=${sub.currentPeriodStart?.toISOString()}  end=${end}`
      );
    }
    console.error('');
  }

  console.error(
    'Keep the row the user actually paid for (cross-check SubscriptionOrder by userId), ' +
      "set the others to status:'expired', then re-run this check."
  );

  return { clean: false, duplicates };
};

if (process.argv[1] && process.argv[1].endsWith('check-duplicate-active-subscriptions.js')) {
  checkDuplicateActiveSubscriptions()
    .then((result) => process.exit(result.clean ? 0 : 1))
    .catch((error) => {
      console.error(`❌ Duplicate check failed: ${error.message}`);
      process.exit(1);
    });
}

export default checkDuplicateActiveSubscriptions;
