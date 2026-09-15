import '../../src/common/globals.js';
import {
  renderStylistResponse,
  generateAcquisitionSuggestions,
  getStylistBookingCta,
} from '../../src/modules/ai/stylist/render.step.js';

describe('Unit — AI Stylist Response Renderer (render.step.js)', () => {
  const mockHydratedItems = new Map([
    [
      'item_1',
      {
        _id: 'item_1',
        name: 'White Oxford Shirt',
        category: 'top',
        subcategory: 'dress_shirt',
        imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/item1.jpg',
        primaryColor: 'White',
        formality: 'formal',
        material: 'cotton',
      },
    ],
    [
      'item_2',
      {
        _id: 'item_2',
        name: 'Navy Suit Trousers',
        category: 'bottom',
        subcategory: 'trousers',
        imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/item2.jpg',
        primaryColor: 'Navy',
        formality: 'formal',
        material: 'wool',
      },
    ],
  ]);

  it('renders hydrated outfits with real names, colors, and Cloudinary URLs', () => {
    const rawOutfits = [
      {
        itemIds: ['item_1', 'item_2'],
        score: 95,
        rationale: 'Classic navy and white formal pairing.',
      },
    ];

    const persistedOutfits = [{ _id: 'outfit_db_999' }];

    const result = renderStylistResponse({
      outfits: rawOutfits,
      sufficiency: 'good',
      missingSlots: [],
      hydratedItemsMap: mockHydratedItems,
      language: 'en',
      persistedOutfits,
    });

    expect(result.sufficiency).toBe('good');
    expect(result.suggestBookStylist).toBe(false);
    expect(result.stylistBookingCta).toBeNull();
    expect(result.outfits).toHaveLength(1);

    const outfit = result.outfits[0];
    expect(outfit.outfitId).toBe('outfit_db_999');
    expect(outfit.score).toBe(95);
    expect(outfit.fromYourWardrobe).toHaveLength(2);
    expect(outfit.fromYourWardrobe[0]).toEqual({
      itemId: 'item_1',
      name: 'White Oxford Shirt',
      category: 'top',
      subcategory: 'dress_shirt',
      imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/item1.jpg',
      primaryColor: 'White',
      formality: 'formal',
      material: 'cotton',
    });
  });

  it('generates acquisition suggestions and human stylist booking CTA when sufficiency is partial', () => {
    const rawOutfits = [
      {
        itemIds: ['item_1', 'item_2'],
        score: 75,
        rationale: 'Solid base outfit, but missing formal shoes and a blazer.',
      },
    ];

    const result = renderStylistResponse({
      outfits: rawOutfits,
      sufficiency: 'partial',
      missingSlots: ['shoes', 'outerwear'],
      hydratedItemsMap: mockHydratedItems,
      language: 'en',
      resolvedDressCode: { formality: ['formal'] },
    });

    expect(result.sufficiency).toBe('partial');
    expect(result.suggestBookStylist).toBe(true);
    expect(result.stylistBookingCta).toContain('Book a verified Murafiq stylist');
    expect(result.suggestedToAcquire).toHaveLength(2);
    expect(result.suggestedToAcquire[0].slot).toBe('shoes');
    expect(result.suggestedToAcquire[0].description).toContain('formal leather dress shoes');
  });

  it('generates Arabic recommendations and CTA when language is ar', () => {
    const result = renderStylistResponse({
      outfits: [],
      sufficiency: 'none',
      missingSlots: ['shoes', 'top', 'bottom'],
      hydratedItemsMap: new Map(),
      language: 'ar',
      resolvedDressCode: { formality: ['formal'] },
    });

    expect(result.language).toBe('ar');
    expect(result.sufficiency).toBe('none');
    expect(result.suggestBookStylist).toBe(true);
    expect(result.stylistBookingCta).toContain('احجز استشارة خاصة مع منسق أزياء معتمد');
    expect(result.suggestedToAcquire[0].description).toContain('حذاء جلدي رسمي');
  });

  it('getStylistBookingCta returns expected copy for both languages', () => {
    expect(getStylistBookingCta('en')).toContain('Book a verified Murafiq stylist');
    expect(getStylistBookingCta('ar')).toContain('احجز استشارة خاصة مع منسق أزياء');
  });

  it('generateAcquisitionSuggestions handles unknown slots gracefully', () => {
    const suggestions = generateAcquisitionSuggestions(['custom_accessory'], 'formal', 'en');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].slot).toBe('custom_accessory');
    expect(suggestions[0].description).toContain('custom_accessory');
  });
});
