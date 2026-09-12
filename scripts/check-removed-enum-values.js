import mongoose from 'mongoose';
import { connectDB } from '../src/database/connection.js';

/**
 * Pre-deploy data check for the enum values the 2026-09 remediation REMOVES.
 *
 * Mongoose validates on WRITE, not on read. A document still holding one of these values
 * therefore keeps loading normally and then throws a ValidationError the next time anything
 * saves it -- which can be weeks after the deploy, on a code path nobody was watching.
 *
 * These four removals were verified absent from the CODE with grep. That proves no code
 * writes them any more; it proves nothing about documents already in the database. This
 * script is the missing half of that proof.
 *
 * STRICTLY READ-ONLY. It only counts documents and lists indexes. Safe to point at the live
 * database, though a recent snapshot is the more cautious choice.
 *
 * Exit code 0 = safe to deploy, 1 = documents must be migrated first.
 */

// `collection` is the real MongoDB collection name (Mongoose lower-cases and pluralises).
const REMOVED_ENUM_VALUES = [
  { collection: 'payments', filter: { status: 'cancelled' }, label: "Payment.status 'cancelled' (S-8)" },
  { collection: 'subscriptions', filter: { status: 'past_due' }, label: "Subscription.status 'past_due' (P4)" },
  { collection: 'notifications', filter: { type: 'safety' }, label: "Notification.type 'safety' (P1)" },
  { collection: 'moderationevents', filter: { actionTaken: 'ALLOW' }, label: "ModerationEvent.actionTaken 'ALLOW' (O-4)" },
];

export const checkRemovedEnumValues = async () => {
  console.log('Connecting to database to check for removed enum values...\n');
  await connectDB();
  const db = mongoose.connection.db;

  const blocking = [];

  for (const { collection, filter, label } of REMOVED_ENUM_VALUES) {
    const count = await db.collection(collection).countDocuments(filter);
    if (count === 0) {
      console.log(`✅ 0 — ${label}`);
    } else {
      console.error(`❌ ${count} document(s) in '${collection}' still hold ${label}`);
      blocking.push({ collection, filter, label, count });
    }
  }

  // Not an enum, and not fatal: the {isFrozen, payoutStatus} index was removed from the schema
  // with the safety scaffolding (P1), but Mongoose NEVER drops an index from a live database.
  // It lingers, consuming writes on every booking update, until somebody drops it by hand.
  const bookingIndexes = await db.collection('bookings').indexes();
  const staleIndexes = bookingIndexes.filter((i) => JSON.stringify(i.key).includes('isFrozen'));
  if (staleIndexes.length > 0) {
    console.warn(
      `\n⚠️  Stale index still present on 'bookings': ${staleIndexes.map((i) => i.name).join(', ')}\n` +
        `   Removed from the schema by P1, but a live index outlives its schema definition.\n` +
        `   Drop with: db.bookings.dropIndex("${staleIndexes[0].name}")`
    );
  }

  if (blocking.length === 0) {
    console.log('\n✅ No documents hold a removed enum value — safe to deploy.');
    return { clean: true, blocking };
  }

  console.error(
    `\n❌ ${blocking.length} collection(s) hold removed enum values. Migrate them to a value the ` +
      'new enum still accepts before deploying, or those documents will fail validation on their ' +
      'next save.'
  );
  return { clean: false, blocking };
};

if (process.argv[1] && process.argv[1].endsWith('check-removed-enum-values.js')) {
  checkRemovedEnumValues()
    .then(async (result) => {
      await mongoose.disconnect();
      process.exit(result.clean ? 0 : 1);
    })
    .catch(async (error) => {
      console.error(`❌ Removed-enum check failed: ${error.message}`);
      try { await mongoose.disconnect(); } catch { /* already down */ }
      process.exit(1);
    });
}

export default checkRemovedEnumValues;
