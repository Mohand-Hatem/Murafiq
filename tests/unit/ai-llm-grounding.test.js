/**
 * Phase 15E Step 2 — LLM Provider Google Search Grounding Tool Support Tests.
 *
 * Covers:
 * 1. complete() passes tools into generateContent config when provided.
 * 2. complete() extracts and returns groundingMetadata from response.candidates[0].
 * 3. complete() without tools leaves config.tools undefined and returns groundingMetadata: null.
 * 4. Backward compatibility with existing completions.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  complete,
  setGenAiClient,
} from '../../src/modules/ai/providers/llm.provider.js';

describe('Phase 15E Step 2 — LLM Provider Grounding Support (llm.provider.js)', () => {
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
    jest.restoreAllMocks();
  });

  it('passes tools parameter to generateContent config and extracts groundingMetadata', async () => {
    const mockGroundingMetadata = {
      webSearchQueries: ['navy formal trousers Egypt buy'],
      groundingChunks: [
        {
          web: {
            uri: 'https://zara.com/eg/en/formal-trousers',
            title: 'Formal Trousers - Zara Egypt',
          },
        },
      ],
      searchEntryPoint: { renderedContent: '<span>Google Search</span>' },
    };

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        items: [
          {
            title: 'Tailored Navy Trousers',
            price: 1200,
          },
        ],
      }),
      candidates: [
        {
          groundingMetadata: mockGroundingMetadata,
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    const result = await complete({
      task: 'reasoning',
      userParts: 'Search for navy trousers in Cairo',
      tools: [{ googleSearch: {} }],
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.tools).toEqual([{ googleSearch: {} }]);
    expect(result.data).toEqual({
      items: [{ title: 'Tailored Navy Trousers', price: 1200 }],
    });
    expect(result.groundingMetadata).toEqual(mockGroundingMetadata);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  it('leaves config.tools undefined and returns groundingMetadata: null when no tools are supplied', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ result: 'ok' }),
      candidates: [
        {
          groundingMetadata: undefined,
        },
      ],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
    });

    const result = await complete({
      task: 'reasoning',
      userParts: 'Standard completion without tools',
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.tools).toBeUndefined();
    expect(result.groundingMetadata).toBeNull();
    expect(result.data).toEqual({ result: 'ok' });
  });
});
