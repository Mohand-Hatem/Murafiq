import mongoose from 'mongoose';
import env from '../src/config/env.config.js';
import { connectDB } from '../src/database/connection.js';
import WardrobeItem, { WARDROBE_COLOR_FAMILIES } from '../src/modules/wardrobe/wardrobe-item.model.js';
import { deriveIsNeutral } from '../src/modules/wardrobe/wardrobe-attribute.normalizer.js';

/**
 * Idempotent backfill script to populate newly introduced HARDENING_08 garment attributes
 * for existing WardrobeItem documents without overwriting existing data.
 */
export const backfillWardrobeAttributes = async () => {
  console.log('🔄 Starting wardrobe attribute backfill...');

  const items = await WardrobeItem.find({
    $or: [
      { isArchived: { $exists: false } },
      { wearCount: { $exists: false } },
      { origin: { $exists: false } },
      { genderPresentation: { $exists: false } },
      { aiPromptVersion: { $exists: false } },
      { isNeutral: { $exists: false } },
    ],
  }).lean();

  console.log(`Found ${items.length} wardrobe item(s) requiring backfill.`);

  let updatedCount = 0;
  for (const item of items) {
    const updates = {};

    if (item.isArchived === undefined || item.isArchived === null) {
      updates.isArchived = false;
    }
    if (item.wearCount === undefined || item.wearCount === null) {
      updates.wearCount = 0;
    }
    if (!item.origin) {
      updates.origin = 'upload';
    }
    if (!item.genderPresentation) {
      updates.genderPresentation = 'unisex';
    }
    if (!item.aiPromptVersion) {
      updates.aiPromptVersion = 'legacy';
    }
    if (item.isNeutral === undefined || item.isNeutral === null) {
      const colorToCheck = item.colorFamily || item.primaryColor;
      updates.isNeutral = deriveIsNeutral(colorToCheck);
    }

    if (Object.keys(updates).length > 0) {
      await WardrobeItem.findByIdAndUpdate(item._id, { $set: updates });
      updatedCount += 1;
    }
  }

  console.log(`✅ Backfill completed: ${updatedCount} document(s) updated.`);
  return { processed: items.length, updated: updatedCount };
};

const run = async () => {
  try {
    await connectDB();
    await backfillWardrobeAttributes();
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
};

if (process.argv[1] && process.argv[1].endsWith('backfill-wardrobe-attributes.js')) {
  run();
}

export default backfillWardrobeAttributes;
