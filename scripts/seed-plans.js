import Plan from '../src/modules/subscriptions/plan.model.js';
import { CANONICAL_PLANS } from '../src/modules/subscriptions/plan.constants.js';
import { connectDB } from '../src/database/connection.js';

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

    console.log(`✅ Successfully seeded ${seededCount} canonical Plans into catalogue.`);
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
