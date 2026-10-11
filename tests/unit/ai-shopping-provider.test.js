/**
 * Unit Tests — AI Shopping Provider Architecture
 *
 * Tests the Shopping Provider interface, Mock provider, Serper provider,
 * SerpApi provider, price parsing, and provider factory resolution.
 */

import { jest } from '@jest/globals';
import { ShoppingProviderInterface } from '../../src/modules/ai/providers/shopping/shopping-provider.interface.js';
import { MockShoppingProvider } from '../../src/modules/ai/providers/shopping/mock-shopping.provider.js';
import {
  SerperShoppingProvider,
  parsePrice,
} from '../../src/modules/ai/providers/shopping/serper-shopping.provider.js';
import { SerpApiShoppingProvider } from '../../src/modules/ai/providers/shopping/serpapi-shopping.provider.js';
import {
  getShoppingProvider,
  setShoppingProvider,
} from '../../src/modules/ai/providers/shopping/shopping-provider.factory.js';
import env from '../../src/config/env.config.js';

describe('Phase 15E — Shopping Provider Architecture', () => {
  describe('ShoppingProviderInterface', () => {
    it('throws error when searchProducts is called directly on base interface', async () => {
      const baseInterface = new ShoppingProviderInterface();
      await expect(baseInterface.searchProducts({ query: 'shirt' })).rejects.toThrow(
        'searchProducts() must be implemented by shopping provider subclass'
      );
    });
  });

  describe('MockShoppingProvider', () => {
    let mockProvider;

    beforeEach(() => {
      mockProvider = new MockShoppingProvider();
    });

    afterEach(() => {
      mockProvider.resetMockResults();
    });

    it('returns default catalog items when query is general or empty', async () => {
      const results = await mockProvider.searchProducts({ query: '', limit: 5 });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(5);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('title');
      expect(results[0]).toHaveProperty('price');
      expect(results[0]).toHaveProperty('productUrl');
      expect(results[0]).toHaveProperty('imageUrl');
      expect(results[0].source).toBe('mock');
    });

    it('matches Arabic fashion keywords (e.g. قميص أبيض)', async () => {
      const results = await mockProvider.searchProducts({ query: 'قميص أبيض', limit: 2 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toMatch(/قميص/);
      expect(results[0].slot).toBe('top');
      expect(results[0].price).toBeGreaterThan(0);
      expect(results[0].productUrl).toContain('http');
    });

    it('matches English fashion keywords and returns English titles when hl=en', async () => {
      const results = await mockProvider.searchProducts({ query: 'navy chino', hl: 'en', limit: 2 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toMatch(/Chino|Trousers/i);
      expect(results[0].slot).toBe('bottom');
    });

    it('respects minPrice and maxPrice filters', async () => {
      const results = await mockProvider.searchProducts({
        query: '',
        minPrice: 1500,
        maxPrice: 3000,
        limit: 10,
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((item) => {
        expect(item.price).toBeGreaterThanOrEqual(1500);
        expect(item.price).toBeLessThanOrEqual(3000);
      });
    });

    it('allows injecting custom mock results for testing', async () => {
      const custom = [
        {
          id: 'custom_1',
          title: 'Custom Test Garment',
          price: 999,
          currency: 'EGP',
          retailer: 'Test Store',
          productUrl: 'https://test.com/item1',
          imageUrl: 'https://test.com/img1.jpg',
        },
      ];
      mockProvider.setMockResults(custom);

      const results = await mockProvider.searchProducts({ query: 'anything' });
      expect(results).toEqual(custom);
    });
  });

  describe('SerperShoppingProvider & parsePrice', () => {
    describe('parsePrice', () => {
      it('handles numbers directly', () => {
        expect(parsePrice(1299)).toBe(1299);
        expect(parsePrice(1450.555)).toBe(1450.56);
      });

      it('parses standard EGP strings with commas and decimals', () => {
        expect(parsePrice('EGP 1,450.00')).toBe(1450);
        expect(parsePrice('1,299 EGP')).toBe(1299);
        expect(parsePrice('2,490.50')).toBe(2490.5);
      });

      it('parses Arabic currency strings and Arabic numerals', () => {
        expect(parsePrice('1450 ج.م')).toBe(1450);
        expect(parsePrice('١٬٤٥٠ ج.م')).toBe(1450);
        expect(parsePrice('١٢٩٩')).toBe(1299);
      });

      it('returns null for empty or invalid values', () => {
        expect(parsePrice(null)).toBeNull();
        expect(parsePrice('')).toBeNull();
        expect(parsePrice('Out of stock')).toBeNull();
      });
    });

    describe('searchProducts execution', () => {
      const originalFetch = globalThis.fetch;

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it('returns empty array when query is blank', async () => {
        const provider = new SerperShoppingProvider('test-api-key');
        const results = await provider.searchProducts({ query: '   ' });
        expect(results).toEqual([]);
      });

      it('returns empty array when API key is missing', async () => {
        const provider = new SerperShoppingProvider('');
        const results = await provider.searchProducts({ query: 'shirt' });
        expect(results).toEqual([]);
      });

      it('parses successful Serper Google Shopping response', async () => {
        const fakeResponse = {
          shopping: [
            {
              title: 'بنطال تشينو سليم فيت كحلي',
              source: 'DeFacto Egypt',
              link: 'https://www.defacto.com/ar-eg/navy-pants',
              price: 'EGP 1,299',
              imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:123',
              rating: 4.6,
              ratingCount: 20,
              productId: 'prod_999',
            },
            {
              title: 'قميص أكسفورد أبيض كلاسيكي',
              source: 'Massimo Dutti Egypt',
              link: 'https://www.massimodutti.com/eg/white-shirt',
              price: '2,290 ج.م',
              imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:456',
              rating: 4.8,
              ratingCount: 35,
              productId: 'prod_888',
            },
          ],
        };

        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => fakeResponse,
        });

        const provider = new SerperShoppingProvider('valid-api-key');
        const results = await provider.searchProducts({
          query: 'بنطال كحلي رجالي',
          gl: 'eg',
          hl: 'ar',
          limit: 5,
        });

        expect(results.length).toBe(2);
        expect(results[0].title).toBe('بنطال تشينو سليم فيت كحلي');
        expect(results[0].retailer).toBe('DeFacto Egypt');
        expect(results[0].price).toBe(1299);
        expect(results[0].productUrl).toBe('https://www.defacto.com/ar-eg/navy-pants');
        expect(results[0].imageUrl).toContain('encrypted-tbn0.gstatic.com');
        expect(results[0].source).toBe('serper');

        expect(results[1].price).toBe(2290);
        expect(results[1].retailer).toBe('Massimo Dutti Egypt');
      });

      it('handles API error status gracefully by returning empty array', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => 'Unauthorized',
        });

        const provider = new SerperShoppingProvider('invalid-key');
        const results = await provider.searchProducts({ query: 'shirt' });
        expect(results).toEqual([]);
      });

      it('handles network failure or fetch throwing gracefully', async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

        const provider = new SerperShoppingProvider('valid-key');
        const results = await provider.searchProducts({ query: 'shirt' });
        expect(results).toEqual([]);
      });
    });
  });

  describe('SerpApiShoppingProvider execution', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns empty array when query is blank', async () => {
      const provider = new SerpApiShoppingProvider('test-api-key');
      const results = await provider.searchProducts({ query: '' });
      expect(results).toEqual([]);
    });

    it('parses successful SerpApi Google Shopping results', async () => {
      const fakeResponse = {
        shopping_results: [
          {
            position: 1,
            title: 'حذاء لوفر جلدي بني',
            link: 'https://www.massimodutti.com/eg/brown-loafer',
            source: 'Massimo Dutti Egypt',
            price: 'EGP 3,450.00',
            extracted_price: 3450,
            thumbnail: 'https://serpapi.com/thumb.jpg',
            rating: 4.9,
            reviews: 15,
            product_id: 'serp_123',
          },
        ],
      };

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeResponse,
      });

      const provider = new SerpApiShoppingProvider('valid-serpapi-key');
      const results = await provider.searchProducts({
        query: 'حذاء لوفر بني',
        gl: 'eg',
        hl: 'ar',
      });

      expect(results.length).toBe(1);
      expect(results[0].title).toBe('حذاء لوفر جلدي بني');
      expect(results[0].price).toBe(3450);
      expect(results[0].retailer).toBe('Massimo Dutti Egypt');
      expect(results[0].productUrl).toBe('https://www.massimodutti.com/eg/brown-loafer');
      expect(results[0].imageUrl).toBe('https://serpapi.com/thumb.jpg');
      expect(results[0].source).toBe('serpapi');
    });
  });

  describe('Shopping Provider Factory', () => {
    afterEach(() => {
      setShoppingProvider(null);
    });

    it('returns mockShoppingProvider when requested or in test mode', () => {
      const provider = getShoppingProvider('mock');
      expect(provider).toBeInstanceOf(MockShoppingProvider);
    });

    it('returns serperShoppingProvider when serper is requested', () => {
      const provider = getShoppingProvider('serper');
      expect(provider).toBeInstanceOf(SerperShoppingProvider);
    });

    it('returns serpapiShoppingProvider when serpapi is requested', () => {
      const provider = getShoppingProvider('serpapi');
      expect(provider).toBeInstanceOf(SerpApiShoppingProvider);
    });

    it('throws on unknown provider name', () => {
      expect(() => getShoppingProvider('unknown_store')).toThrow(/Unknown shopping provider/);
    });

    it('respects setShoppingProvider test override', () => {
      const customOverride = { searchProducts: jest.fn() };
      setShoppingProvider(customOverride);

      const resolved = getShoppingProvider('serper');
      expect(resolved).toBe(customOverride);
    });

    it('refuses to use mock provider when NODE_ENV is production', () => {
      const originalNodeEnv = env.NODE_ENV;
      try {
        env.NODE_ENV = 'production';
        expect(() => getShoppingProvider('mock')).toThrow(
          /Refusing to use mock shopping provider in production/
        );
      } finally {
        env.NODE_ENV = originalNodeEnv;
      }
    });
  });
});
