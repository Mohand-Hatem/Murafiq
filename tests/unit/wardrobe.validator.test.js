import {
  createWardrobeItemSchema,
  updateWardrobeItemSchema,
  wardrobeQuerySchema,
} from '../../src/modules/wardrobe/wardrobe.validator.js';

describe('Wardrobe Validator Unit Tests', () => {
  describe('createWardrobeItemSchema', () => {
    it('should validate a valid image URL', () => {
      const result = createWardrobeItemSchema.body.safeParse({
        imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/shirt.jpg',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid or missing image URL', () => {
      const missing = createWardrobeItemSchema.body.safeParse({});
      expect(missing.success).toBe(false);

      const invalidUrl = createWardrobeItemSchema.body.safeParse({
        imageUrl: 'not-a-valid-url',
      });
      expect(invalidUrl.success).toBe(false);
    });

    it('should reject unexpected extra fields (strict mode)', () => {
      const result = createWardrobeItemSchema.body.safeParse({
        imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/shirt.jpg',
        extraField: 'not allowed',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateWardrobeItemSchema', () => {
    it('should allow partial attribute updates', () => {
      const result = updateWardrobeItemSchema.body.safeParse({
        category: 'top',
        primaryColor: 'Navy Blue',
        secondaryColors: ['White', 'Red'],
        pattern: 'striped',
        formality: 'casual',
        season: ['summer', 'spring'],
        material: 'cotton',
        styleTags: ['nautical', 'summer'],
        aiDescription: 'Navy blue and white striped nautical cotton polo shirt.',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid category enum', () => {
      const result = updateWardrobeItemSchema.body.safeParse({
        category: 'spacesuit',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('wardrobeQuerySchema', () => {
    it('should apply defaults and coerce numbers', () => {
      const result = wardrobeQuerySchema.query.safeParse({
        page: '2',
        limit: '15',
        category: 'shoes',
        search: 'leather',
      });
      expect(result.success).toBe(true);
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(15);
      expect(result.data.category).toBe('shoes');
      expect(result.data.search).toBe('leather');
    });
  });
});
