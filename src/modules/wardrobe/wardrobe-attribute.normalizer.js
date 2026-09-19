import {
  WARDROBE_CATEGORIES,
  WARDROBE_PATTERNS,
  WARDROBE_FORMALITIES,
  WARDROBE_SEASONS,
  WARDROBE_MATERIALS,
  WARDROBE_FITS,
  WARDROBE_COLOR_FAMILIES,
  WARDROBE_GENDER_PRESENTATIONS,
} from './wardrobe-item.model.js';

const FORMALITY_ALIASES = {
  'smart-casual': 'smart_casual',
  'smart casual': 'smart_casual',
  business_casual: 'smart_casual',
  'business casual': 'smart_casual',
  athletic: 'sportswear',
  sport: 'sportswear',
  activewear: 'sportswear',
  gym: 'sportswear',
  lounge: 'loungewear',
  sleepwear: 'loungewear',
};

const PATTERN_ALIASES = {
  'polka dot': 'polka_dot',
  polkadot: 'polka_dot',
  dots: 'polka_dot',
  'animal print': 'animal_print',
  leopard: 'animal_print',
  zebra: 'animal_print',
  plaid: 'plaid',
  tartan: 'plaid',
  stripes: 'striped',
  plain: 'solid',
};

const SEASON_ALIASES = {
  'all-season': 'all_season',
  'all season': 'all_season',
  all: 'all_season',
  autumn: 'fall',
};

const MATERIAL_ALIASES = {
  knit: 'knitwear',
  knitted: 'knitwear',
  polyester: 'synthetic',
  nylon: 'synthetic',
  spandex: 'synthetic',
  rayon: 'synthetic',
  viscose: 'synthetic',
  fleece: 'synthetic',
};

const FIT_ALIASES = {
  tight: 'slim',
  skinny: 'slim',
  fitted: 'slim',
  standard: 'regular',
  normal: 'regular',
  loose: 'relaxed',
  baggy: 'oversized',
};

const GENDER_ALIASES = {
  men: 'masculine',
  mens: 'masculine',
  male: 'masculine',
  masculine: 'masculine',
  women: 'feminine',
  womens: 'feminine',
  female: 'feminine',
  feminine: 'feminine',
  unisex: 'unisex',
  neutral: 'unisex',
  all: 'unisex',
};

const COLOR_FAMILY_ALIASES = {
  off_white: 'white',
  'off-white': 'white',
  ivory: 'white',
  cream: 'white',
  gray: 'grey',
  charcoal: 'grey',
  tan: 'beige',
  khaki: 'beige',
  nude: 'beige',
  camel: 'brown',
  burgundy: 'red',
  maroon: 'red',
  gold: 'metallic',
  silver: 'metallic',
  bronze: 'metallic',
};

const NEUTRAL_COLORS = new Set(['black', 'white', 'grey', 'navy', 'beige', 'brown']);

/**
 * Normalizes a single string token: trim, lowercase, replace spaces/dashes with underscores.
 */
export const sanitizeString = (val) => {
  if (typeof val !== 'string') return '';
  return val.trim().toLowerCase();
};

/**
 * Normalizes a value against an allowed enum set and alias mapping.
 */
export const mapToEnum = (val, allowedList, aliasMap = {}) => {
  const sanitized = sanitizeString(val);
  if (!sanitized) return null;

  if (allowedList.includes(sanitized)) {
    return sanitized;
  }

  const aliased = aliasMap[sanitized];
  if (aliased && allowedList.includes(aliased)) {
    return aliased;
  }

  // Also try replacing spaces/hyphens with underscores
  const underscored = sanitized.replace(/[\s-]+/g, '_');
  if (allowedList.includes(underscored)) {
    return underscored;
  }

  return null;
};

/**
 * Checks if a colorFamily is a neutral color.
 */
export const deriveIsNeutral = (colorFamily) => {
  if (!colorFamily) return false;
  return NEUTRAL_COLORS.has(colorFamily.toLowerCase());
};

/**
 * Normalizes extracted garment attributes and detects if human review is needed.
 * @param {Object} raw - Raw classifier output
 * @returns {{ normalized: Object, needsReview: boolean }}
 */
export const normalizeGarmentAttributes = (raw = {}) => {
  let needsReview = false;

  const category = mapToEnum(raw.category, WARDROBE_CATEGORIES);
  if (!category && raw.category) needsReview = true;

  const pattern = mapToEnum(raw.pattern, WARDROBE_PATTERNS, PATTERN_ALIASES) || 'solid';

  const formality = mapToEnum(raw.formality, WARDROBE_FORMALITIES, FORMALITY_ALIASES);
  if (!formality && raw.formality) needsReview = true;

  const rawSeasons = Array.isArray(raw.season) ? raw.season : [raw.season];
  const season = Array.from(
    new Set(
      rawSeasons
        .map((s) => mapToEnum(s, WARDROBE_SEASONS, SEASON_ALIASES))
        .filter(Boolean)
    )
  );
  if (season.length === 0) {
    season.push('all_season');
  }

  const material = mapToEnum(raw.material, WARDROBE_MATERIALS, MATERIAL_ALIASES) || 'other';
  const fit = mapToEnum(raw.fit, WARDROBE_FITS, FIT_ALIASES) || 'regular';

  const colorFamily = mapToEnum(raw.colorFamily, WARDROBE_COLOR_FAMILIES, COLOR_FAMILY_ALIASES) ||
    mapToEnum(raw.primaryColor, WARDROBE_COLOR_FAMILIES, COLOR_FAMILY_ALIASES) ||
    'other';

  const genderPresentation = mapToEnum(
    raw.genderPresentation,
    WARDROBE_GENDER_PRESENTATIONS,
    GENDER_ALIASES
  ) || 'unisex';

  const isNeutral = deriveIsNeutral(colorFamily);

  const normalized = {
    category: category || raw.category || 'top',
    subcategory: sanitizeString(raw.subcategory) || null,
    primaryColor: raw.primaryColor?.trim() || 'Unknown',
    secondaryColors: Array.isArray(raw.secondaryColors)
      ? raw.secondaryColors.map((c) => c.trim()).filter(Boolean)
      : [],
    pattern,
    formality: formality || 'casual',
    season,
    material,
    fit,
    colorFamily: WARDROBE_COLOR_FAMILIES.includes(colorFamily) ? colorFamily : 'multicolor',
    isNeutral,
    genderPresentation,
    printedText: raw.printedText?.trim() || '',
    styleTags: Array.isArray(raw.styleTags)
      ? raw.styleTags.map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [],
    aiDescription: raw.aiDescription?.trim() || '',
    aiConfidence: typeof raw.aiConfidence === 'number' ? Math.max(0, Math.min(1, raw.aiConfidence)) : 0.9,
  };

  return { normalized, needsReview };
};

export default {
  sanitizeString,
  mapToEnum,
  deriveIsNeutral,
  normalizeGarmentAttributes,
};
