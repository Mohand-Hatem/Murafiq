import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import { composeAndRankOutfits, COMPOSE_RESPONSE_SCHEMA } from '../../src/modules/ai/stylist/compose.step.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';

describe('Unit — AI Stylist Composition Step (compose.step.js)', () => {
  let mockGenerateContent;

  beforeEach(() => {
    mockGenerateContent = jest.fn();
    setGenAiClient({
      models: {
        generateContent: mockGenerateContent,
      },
    });
  });

  afterEach(() => {
    setGenAiClient(null);
    jest.clearAllMocks();
  });

  const mockCandidates = {
    top: [
      {
        _id: 'top_1',
        category: 'top',
        subcategory: 'dress_shirt',
        name: 'White Dress Shirt',
        primaryColor: 'White',
        formality: 'formal',
        aiDescription: 'Crisp white cotton dress shirt',
      },
    ],
    bottom: [
      {
        _id: 'bottom_1',
        category: 'bottom',
        subcategory: 'trousers',
        name: 'Navy Trousers',
        primaryColor: 'Navy',
        formality: 'formal',
        aiDescription: 'Tailored navy formal trousers',
      },
    ],
    shoes: [
      {
        _id: 'shoes_1',
        category: 'shoes',
        subcategory: 'oxford',
        name: 'Black Oxfords',
        primaryColor: 'Black',
        formality: 'formal',
        aiDescription: 'Polished black leather oxford shoes',
      },
    ],
  };

  const mockDressCode = {
    eventType: 'wedding_formal',
    formality: ['formal', 'business'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
    highStakes: true,
  };

  const mockPreferences = {
    favoriteColors: ['navy', 'white'],
    avoidedColors: ['brown'],
    modestyPreference: 'standard',
  };

  it('formats candidates, preferences, and dress code into user prompt and sends schema', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        outfits: [
          {
            itemIds: ['top_1', 'bottom_1', 'shoes_1'],
            rationale: 'Classic formal navy and white pairing ideal for an evening wedding.',
            score: 95,
          },
        ],
        sufficiency: 'good',
        missingSlots: [],
      }),
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 50 },
    });

    const result = await composeAndRankOutfits({
      candidatesBySlot: mockCandidates,
      resolvedDressCode: mockDressCode,
      preferences: mockPreferences,
      eventContext: { season: 'fall', timeOfDay: 'evening' },
      language: 'en',
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateContent.mock.calls[0][0];

    expect(callArgs.config.responseSchema).toEqual(COMPOSE_RESPONSE_SCHEMA);
    expect(callArgs.contents[0].parts[0].text).toContain('White Dress Shirt');
    expect(callArgs.contents[0].parts[0].text).toContain('Navy Trousers');
    expect(callArgs.contents[0].parts[0].text).toContain('Black Oxfords');
    expect(callArgs.contents[0].parts[0].text).toContain('wedding_formal');
    expect(callArgs.config.systemInstruction).toContain('CRITICAL: Write all outfit rationales in fluent, professional English');

    expect(result.outfits).toHaveLength(1);
    expect(result.outfits[0].itemIds).toEqual(['top_1', 'bottom_1', 'shoes_1']);
    expect(result.outfits[0].score).toBe(95);
    expect(result.sufficiency).toBe('good');
  });

  it('supports Arabic rationale instruction when language is ar', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        outfits: [
          {
            itemIds: ['top_1', 'bottom_1', 'shoes_1'],
            rationale: 'إطلالة كلاسيكية أنيقة تناسب حضور حفل زفاف رسمي.',
            score: 92,
          },
        ],
        sufficiency: 'good',
        missingSlots: [],
      }),
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 50 },
    });

    const result = await composeAndRankOutfits({
      candidatesBySlot: mockCandidates,
      resolvedDressCode: mockDressCode,
      preferences: mockPreferences,
      language: 'ar',
    });

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain('CRITICAL: Write all outfit rationales in natural, elegant, modern Arabic');

    expect(result.outfits[0].rationale).toContain('إطلالة كلاسيكية');
  });

  it('handles partial sufficiency and missing slots cleanly', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        outfits: [
          {
            itemIds: ['top_1', 'bottom_1', 'shoes_1'],
            rationale: 'A solid outfit, though an evening blazer would elevate it.',
            score: 78,
          },
        ],
        sufficiency: 'partial',
        missingSlots: ['outerwear'],
      }),
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
    });

    const result = await composeAndRankOutfits({
      candidatesBySlot: mockCandidates,
      resolvedDressCode: mockDressCode,
      language: 'en',
    });

    expect(result.sufficiency).toBe('partial');
    expect(result.missingSlots).toEqual(['outerwear']);
  });

  it('clamps scores between 0 and 100', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        outfits: [
          { itemIds: ['top_1'], rationale: 'too high', score: 150 },
          { itemIds: ['top_1'], rationale: 'too low', score: -20 },
        ],
        sufficiency: 'good',
        missingSlots: [],
      }),
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
    });

    const result = await composeAndRankOutfits({
      candidatesBySlot: mockCandidates,
      resolvedDressCode: mockDressCode,
    });

    expect(result.outfits[0].score).toBe(100);
    expect(result.outfits[1].score).toBe(0);
  });
});
