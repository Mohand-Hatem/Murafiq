import { BUSINESS_TIMEZONE } from './defaults.constant.js';

/**
 * Deterministic dress-code filter mappings for the AI Stylist retrieval pipeline.
 *
 * Each event type maps to:
 * - formality: Allowed garment formality levels from WARDROBE_FORMALITIES
 * - requiredSlots: Categories that must be satisfied for a complete outfit
 * - optionalSlots: Supplemental categories that may be retrieved to enhance the outfit
 * - highStakes: Indicates whether strict adherence to formality and etiquette is mandatory
 */
export const DRESS_CODE_MAP = Object.freeze({
  wedding_formal: {
    formality: ['formal', 'business'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: true,
  },
  wedding_casual: {
    formality: ['smart_casual', 'formal'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: true,
  },
  engagement: {
    formality: ['formal', 'smart_casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: true,
  },
  formal_gala: {
    formality: ['formal'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: true,
  },
  birthday_party: {
    formality: ['casual', 'smart_casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: false,
  },
  dinner_casual: {
    formality: ['casual', 'smart_casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: false,
  },
  dinner_fine_dining: {
    formality: ['smart_casual', 'formal'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: true,
  },
  business_meeting: {
    formality: ['business', 'smart_casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: true,
  },
  interview: {
    formality: ['business', 'formal'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: true,
  },
  work_office: {
    formality: ['business', 'smart_casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: false,
  },
  work_smart_casual: {
    formality: ['smart_casual', 'casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: false,
  },
  university: {
    formality: ['casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: false,
  },
  travel: {
    formality: ['casual', 'loungewear'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: false,
  },
  gym_sport: {
    formality: ['sportswear'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['accessory'],
    highStakes: false,
  },
  beach: {
    formality: ['casual', 'loungewear'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['accessory'],
    highStakes: false,
  },
  funeral: {
    formality: ['formal', 'business'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: true,
  },
  eid_religious: {
    formality: ['smart_casual', 'formal'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: true,
  },
  date_night: {
    formality: ['smart_casual', 'casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: false,
  },
  family_gathering: {
    formality: ['casual', 'smart_casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: false,
  },
  cocktail_party: {
    formality: ['formal', 'smart_casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory', 'dress'],
    highStakes: true,
  },
  casual_outing: {
    formality: ['casual'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: false,
  },
});

export const EVENT_TYPES = Object.freeze(Object.keys(DRESS_CODE_MAP));

/**
 * Resolves a given eventType string against the canonical DRESS_CODE_MAP.
 * Acts as the pipeline's deterministic second scope gate.
 *
 * @param {string} eventType - The event name to resolve
 * @returns {{ resolved: true, eventType: string, formality: string[], requiredSlots: string[], optionalSlots: string[], highStakes: boolean } | { resolved: false, eventType: string | null }}
 */
export const resolveDressCode = (eventType) => {
  if (!eventType || typeof eventType !== 'string') {
    return { resolved: false, eventType: eventType ? String(eventType) : null };
  }

  const normalized = eventType.trim().toLowerCase();
  const rule = DRESS_CODE_MAP[normalized];

  if (!rule) {
    return { resolved: false, eventType: normalized };
  }

  return {
    resolved: true,
    eventType: normalized,
    formality: [...rule.formality],
    requiredSlots: [...rule.requiredSlots],
    optionalSlots: [...rule.optionalSlots],
    highStakes: rule.highStakes,
  };
};

/**
 * Derives the calendar season for a given date in the Africa/Cairo timezone.
 *
 * Seasonal distribution in Egypt (Northern Hemisphere):
 * - Spring: March, April, May (Months 3, 4, 5)
 * - Summer: June, July, August (Months 6, 7, 8)
 * - Fall: September, October, November (Months 9, 10, 11)
 * - Winter: December, January, February (Months 12, 1, 2)
 *
 * @param {Date|string|number} [date=new Date()]
 * @param {string} [timeZone=BUSINESS_TIMEZONE]
 * @returns {'spring' | 'summer' | 'fall' | 'winter'}
 */
export const deriveSeason = (date = new Date(), timeZone = BUSINESS_TIMEZONE) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date provided to deriveSeason');
  }

  const parts = new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric' }).formatToParts(d);
  const monthPart = parts.find((p) => p.type === 'month');
  const month = parseInt(monthPart.value, 10);

  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter';
};

/**
 * Derives which wardrobe slots should complement a given anchor garment category
 * for Phase 15C Flow B (image-based styling).
 *
 * @param {string} anchorCategory - The classified category of the uploaded garment
 * @returns {string[]} Array of complementary slot categories to retrieve
 */
const COMPLEMENTARY_SLOT_MAP = Object.freeze({
  top: ['bottom', 'shoes', 'outerwear', 'accessory'],
  bottom: ['top', 'shoes', 'outerwear', 'accessory'],
  dress: ['shoes', 'outerwear', 'accessory'],
  shoes: ['top', 'bottom', 'outerwear', 'accessory'],
  outerwear: ['top', 'bottom', 'shoes', 'accessory'],
  accessory: ['top', 'bottom', 'shoes'],
});

export const deriveComplementarySlots = (anchorCategory) => {
  if (!anchorCategory || typeof anchorCategory !== 'string') {
    return ['top', 'bottom', 'shoes'];
  }
  const normalized = anchorCategory.trim().toLowerCase();
  return COMPLEMENTARY_SLOT_MAP[normalized] || ['top', 'bottom', 'shoes'];
};
