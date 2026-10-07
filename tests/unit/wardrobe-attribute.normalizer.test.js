import {
  mapToEnum,
  deriveIsNeutral,
  normalizeGarmentAttributes,
  generateGarmentDisplayLabel,
} from '../../src/modules/wardrobe/wardrobe-attribute.normalizer.js';
import {
  WARDROBE_CATEGORIES,
  WARDROBE_FORMALITIES,
  WARDROBE_PATTERNS,
} from '../../src/modules/wardrobe/wardrobe-item.model.js';

describe('Wardrobe Attribute Normalizer Unit Tests', () => {
  describe('mapToEnum', () => {
    it('should map exact matches correctly', () => {
      expect(mapToEnum('top', WARDROBE_CATEGORIES)).toBe('top');
      expect(mapToEnum('casual', WARDROBE_FORMALITIES)).toBe('casual');
    });

    it('should map case-insensitive and trimmed values', () => {
      expect(mapToEnum('  FORMAL  ', WARDROBE_FORMALITIES)).toBe('formal');
      expect(mapToEnum('Solid', WARDROBE_PATTERNS)).toBe('solid');
    });

    it('should map aliases and hyphenated variations', () => {
      const aliasMap = { 'smart-casual': 'smart_casual', 'smart casual': 'smart_casual' };
      expect(mapToEnum('smart casual', WARDROBE_FORMALITIES, aliasMap)).toBe('smart_casual');
      expect(mapToEnum('smart-casual', WARDROBE_FORMALITIES, aliasMap)).toBe('smart_casual');
    });

    it('should return null for unmappable values', () => {
      expect(mapToEnum('completely_unknown_value', WARDROBE_CATEGORIES)).toBeNull();
      expect(mapToEnum(null, WARDROBE_CATEGORIES)).toBeNull();
    });
  });

  describe('deriveIsNeutral', () => {
    it('should return true for neutral colors', () => {
      expect(deriveIsNeutral('black')).toBe(true);
      expect(deriveIsNeutral('white')).toBe(true);
      expect(deriveIsNeutral('grey')).toBe(true);
      expect(deriveIsNeutral('navy')).toBe(true);
      expect(deriveIsNeutral('beige')).toBe(true);
      expect(deriveIsNeutral('brown')).toBe(true);
    });

    it('should return false for non-neutral colors', () => {
      expect(deriveIsNeutral('red')).toBe(false);
      expect(deriveIsNeutral('yellow')).toBe(false);
      expect(deriveIsNeutral('purple')).toBe(false);
      expect(deriveIsNeutral(null)).toBe(false);
    });
  });

  describe('normalizeGarmentAttributes', () => {
    it('should normalize raw attributes cleanly and derive isNeutral', () => {
      const raw = {
        category: 'TOP',
        subcategory: ' Oxford Shirt ',
        primaryColor: 'Off-White',
        pattern: 'Solid',
        formality: 'Smart Casual',
        season: ['Spring', 'All Season'],
        material: 'Cotton',
        fit: 'Slim',
        colorFamily: 'off-white',
        genderPresentation: 'Men',
        styleTags: ['CLASSIC', 'Preppy'],
        aiDescription: 'A classic oxford button-down shirt',
        aiConfidence: 0.98,
      };

      const { normalized, needsReview } = normalizeGarmentAttributes(raw);

      expect(needsReview).toBe(false);
      expect(normalized.category).toBe('top');
      expect(normalized.subcategory).toBe('oxford shirt');
      expect(normalized.formality).toBe('smart_casual');
      expect(normalized.pattern).toBe('solid');
      expect(normalized.season).toEqual(['spring', 'all_season']);
      expect(normalized.material).toBe('cotton');
      expect(normalized.fit).toBe('slim');
      expect(normalized.colorFamily).toBe('white');
      expect(normalized.isNeutral).toBe(true);
      expect(normalized.genderPresentation).toBe('masculine');
      expect(normalized.styleTags).toEqual(['classic', 'preppy']);
    });

    it('should flag needsReview when category is unmappable', () => {
      const raw = {
        category: 'unrecognized_space_suit',
        formality: 'casual',
      };

      const { needsReview } = normalizeGarmentAttributes(raw);
      expect(needsReview).toBe(true);
    });

    it('should derive primaryColor and secondaryColors from colors array when primaryColor is absent', () => {
      const raw = {
        category: 'top',
        colors: ['Navy', 'White'],
        colorFamily: 'navy',
        confidence: 0.92,
      };

      const { normalized } = normalizeGarmentAttributes(raw);
      expect(normalized.primaryColor).toBe('Navy');
      expect(normalized.secondaryColors).toEqual(['White']);
      expect(normalized.colorFamily).toBe('navy');
      expect(normalized.aiConfidence).toBe(0.92);
      expect(normalized.confidence).toBe(0.92);
    });

    it('should derive primaryColor from colorFamily when primaryColor and colors are missing', () => {
      const raw = {
        category: 'bottom',
        colorFamily: 'blue',
      };

      const { normalized } = normalizeGarmentAttributes(raw);
      expect(normalized.primaryColor).toBe('blue');
      expect(normalized.secondaryColors).toEqual([]);
      expect(normalized.colorFamily).toBe('blue');
    });

    it('should fallback to Unknown when no color information is provided', () => {
      const raw = {
        category: 'shoes',
      };

      const { normalized } = normalizeGarmentAttributes(raw);
      expect(normalized.primaryColor).toBe('Unknown');
      expect(normalized.secondaryColors).toEqual([]);
    });
  });

  describe('generateGarmentDisplayLabel', () => {
    it('preserves existing explicit item.name', () => {
      expect(generateGarmentDisplayLabel({ name: 'My Favorite Blazer' })).toBe('My Favorite Blazer');
    });

    it('generates rich label with color, subcategory, and material', () => {
      const item = {
        primaryColor: 'navy',
        subcategory: 'oxford_shirt',
        material: 'cotton',
      };
      expect(generateGarmentDisplayLabel(item)).toBe('Navy Oxford Shirt (Cotton)');
    });

    it('falls back to category when subcategory is missing', () => {
      const item = {
        colorFamily: 'white',
        category: 'top',
      };
      expect(generateGarmentDisplayLabel(item)).toBe('White Top');
    });

    it('omits unknown or other colors and generic materials', () => {
      const item = {
        primaryColor: 'Unknown',
        colorFamily: 'other',
        subcategory: 'chinos',
        material: 'synthetic',
      };
      expect(generateGarmentDisplayLabel(item)).toBe('Chinos');
    });

    it('returns default fallback when empty or invalid input is passed', () => {
      expect(generateGarmentDisplayLabel({})).toBe('Garment');
      expect(generateGarmentDisplayLabel(null)).toBe('Wardrobe Item');
    });
  });
});
