/**
 * Common Wardrobe & Fashion Domain Constants.
 * Shared across Wardrobe, Stylist, Preferences, and Search modules.
 */

export const WARDROBE_CATEGORIES = Object.freeze([
  'top',
  'bottom',
  'dress',
  'outerwear',
  'shoes',
  'accessory',
  'others',
]);

export const WARDROBE_CATEGORY_METADATA = Object.freeze({
  top: {
    id: 'top',
    name: 'Top Clothes',
    nameAr: 'ملابس علوية',
    description: 'Shirts, t-shirts, blouses, polos, and light tops',
    icon: 'shirt',
    order: 1,
    isFallback: false,
  },
  bottom: {
    id: 'bottom',
    name: 'Bottom Clothes',
    nameAr: 'ملابس سفلية',
    description: 'Pants, jeans, skirts, shorts, and trousers',
    icon: 'pant',
    order: 2,
    isFallback: false,
  },
  dress: {
    id: 'dress',
    name: 'Outfits',
    nameAr: 'أطقم وفساتين',
    description: 'Full outfits, suits, dresses, matching sets, and jumpsuits',
    icon: 'dress',
    order: 3,
    isFallback: false,
  },
  outerwear: {
    id: 'outerwear',
    name: 'Winter / Heavy Clothes',
    nameAr: 'ملابس شتوية وثقيلة',
    description: 'Coats, heavy jackets, parkas, sweaters, and winter knitwear',
    icon: 'coat',
    order: 4,
    isFallback: false,
  },
  shoes: {
    id: 'shoes',
    name: 'Shoes',
    nameAr: 'أحذية',
    description: 'Sneakers, formal shoes, boots, heels, and sandals',
    icon: 'shoe',
    order: 5,
    isFallback: false,
  },
  accessory: {
    id: 'accessory',
    name: 'Accessories',
    nameAr: 'إكسسوارات',
    description: 'Bags, watches, belts, hats, scarves, and jewelry',
    icon: 'watch',
    order: 6,
    isFallback: false,
  },
  others: {
    id: 'others',
    name: 'Others',
    nameAr: 'أخرى',
    description: 'Unsorted, ambiguous, or utility garments',
    icon: 'dots-horizontal',
    order: 7,
    isFallback: true,
  },
});

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
  WARDROBE_CATEGORY_METADATA,
  WARDROBE_PATTERNS,
  WARDROBE_FORMALITIES,
  WARDROBE_SEASONS,
  WARDROBE_MATERIALS,
  WARDROBE_FITS,
  WARDROBE_COLOR_FAMILIES,
  WARDROBE_GENDER_PRESENTATIONS,
};
