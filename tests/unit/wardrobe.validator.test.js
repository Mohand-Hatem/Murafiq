import {
  createWardrobeItemSchema,
  updateWardrobeItemSchema,
  wardrobeQuerySchema,
} from '../../src/modules/wardrobe/wardrobe.validator.js';

describe('Wardrobe Validator Unit Tests', () => {
  describe('createWardrobeItemSchema', () => {
    it('should validate a valid namespaced uploadRef', () => {
      const result = createWardrobeItemSchema.body.safeParse({
        uploadRef: 'murafiq/wardrobe/507f1f77bcf86cd799439011/abc-123_uuid',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing uploadRef', () => {
      const missing = createWardrobeItemSchema.body.safeParse({});
      expect(missing.success).toBe(false);
    });

    it('should reject invalid or non-namespaced uploadRef', () => {
      const invalid = [
        'invalid-ref',
        'murafiq/wardrobe/not-an-objectid/item',
        'murafiq/kyc-documents/507f1f77bcf86cd799439011/item',
        'random/path/image.jpg',
      ];

      for (const uploadRef of invalid) {
        const result = createWardrobeItemSchema.body.safeParse({ uploadRef });
        expect(result.success).toBe(false);
      }
    });

    it('should reject unexpected extra fields (strict mode)', () => {
      const result = createWardrobeItemSchema.body.safeParse({
        uploadRef: 'murafiq/wardrobe/507f1f77bcf86cd799439011/abc-123_uuid',
        extraField: 'not allowed',
      });
      expect(result.success).toBe(false);
    });

    // Regression test for SSRF: raw URLs must be rejected outright
    it('should reject raw URLs instead of uploadRef (SSRF guard)', () => {
      const attempts = [
        'https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/shirt.jpg',
        'http://169.254.169.254/latest/meta-data/',
        'http://localhost:6379/',
        'http://127.0.0.1:27017/',
        'https://evil.example.com/fake.jpg',
      ];

      for (const uploadRef of attempts) {
        const result = createWardrobeItemSchema.body.safeParse({ uploadRef });
        expect(result.success).toBe(false);
      }
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
