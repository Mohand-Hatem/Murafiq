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

export const FORMALITY_ADJACENCY = Object.freeze({
  casual: ['casual', 'smart_casual'],
  smart_casual: ['smart_casual', 'casual', 'business'],
  business: ['business', 'smart_casual', 'formal'],
  formal: ['formal', 'business', 'smart_casual'],
  sportswear: ['sportswear', 'casual'],
  loungewear: ['loungewear', 'casual'],
});

export const expandFormalityAdjacency = (formality) => {
  if (!formality) return null;
  const list = Array.isArray(formality) ? formality : [formality];
  const expanded = new Set();
  for (const f of list) {
    const adj = FORMALITY_ADJACENCY[f];
    if (adj) {
      adj.forEach((item) => expanded.add(item));
    } else {
      expanded.add(f);
    }
  }
  return Array.from(expanded);
};

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
