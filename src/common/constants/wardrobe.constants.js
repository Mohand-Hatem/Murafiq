/**
 * Common Wardrobe & Fashion Domain Constants.
 * Shared across Wardrobe, Stylist, Preferences, and Search modules.
 */

export const WARDROBE_CATEGORIES = Object.freeze([
  'top',
  'bottom',
  'shoes',
  'outerwear',
  'accessory',
  'dress',
]);

export const WARDROBE_PATTERNS = Object.freeze([
  'solid',
  'striped',
  'plaid',
  'floral',
  'graphic',
  'checkered',
  'polka_dot',
  'animal_print',
  'other',
]);

export const WARDROBE_FORMALITIES = Object.freeze([
  'casual',
  'smart_casual',
  'business',
  'formal',
  'loungewear',
  'sportswear',
]);

export const WARDROBE_SEASONS = Object.freeze([
  'spring',
  'summer',
  'fall',
  'winter',
  'all_season',
]);

export const WARDROBE_MATERIALS = Object.freeze([
  'cotton',
  'denim',
  'leather',
  'wool',
  'silk',
  'linen',
  'synthetic',
  'knitwear',
  'other',
]);

export const WARDROBE_FITS = Object.freeze([
  'slim',
  'regular',
  'relaxed',
  'oversized',
]);

export const WARDROBE_COLOR_FAMILIES = Object.freeze([
  'black',
  'white',
  'grey',
  'navy',
  'blue',
  'brown',
  'beige',
  'green',
  'red',
  'pink',
  'purple',
  'yellow',
  'orange',
  'metallic',
  'multicolor',
]);

export const WARDROBE_GENDER_PRESENTATIONS = Object.freeze([
  'masculine',
  'feminine',
  'unisex',
]);

export default {
  WARDROBE_CATEGORIES,
  WARDROBE_PATTERNS,
  WARDROBE_FORMALITIES,
  WARDROBE_SEASONS,
  WARDROBE_MATERIALS,
  WARDROBE_FITS,
  WARDROBE_COLOR_FAMILIES,
  WARDROBE_GENDER_PRESENTATIONS,
};
