import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { scanText } from '../../src/modules/moderation/moderation.scanner.js';
import blockedWordRepository from '../../src/modules/moderation/blocked-word.repository.js';
import moderationService from '../../src/modules/moderation/moderation.service.js';
import { addBlockedWordSchema, addBlockedWordsBulkSchema } from '../../src/modules/moderation/blocked-word.validator.js';

describe('Blocked Words Moderation & Lexicon (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    moderationService.invalidateBlockedWordsCache();
  });

  describe('Scanner — scanText with blockedWords', () => {
    const sampleBlockedWords = [
      { word: 'badword', severity: 'HIGH', category: 'PROFANITY' },
      { word: 'شتيمة', severity: 'CRITICAL', category: 'INSULT' },
      { word: 'harassmentterm', severity: 'MEDIUM', category: 'HARASSMENT' },
    ];

    it('flags text containing an English blocked word', () => {
      const result = scanText('Hello this is a badword test', [], sampleBlockedWords);
      expect(result.isFlagged).toBe(true);
      expect(result.matchedLayer).toBe('WORD_LIST');
      expect(result.matchedRule).toBe('BLOCKED_WORD_BADWORD');
      expect(result.severity).toBe('HIGH');
    });

    it('flags text containing an Arabic blocked word even with tashkeel/diacritics', () => {
      // شَتِيمَة with fathah and kasrah
      const result = scanText('انت انسان شَتِيمَة جدا', [], sampleBlockedWords);
      expect(result.isFlagged).toBe(true);
      expect(result.matchedLayer).toBe('WORD_LIST');
      expect(result.severity).toBe('CRITICAL');
    });

    it('passes clean text without any blocked words', () => {
      const result = scanText('Clean message for booking haircut', [], sampleBlockedWords);
      expect(result.isFlagged).toBe(false);
    });
  });

  describe('Validator — blocked-word.validator', () => {
    // Schemas are shaped { body: z.object(...) } to match validate.middleware.js's
    // contract (it reads schema.body/.query/.params) -- they were previously exported
    // as bare Zod schemas, which meant validate() found nothing to parse and silently
    // let every request through unvalidated.
    it('exposes body/query on the exported schema, not a bare Zod schema', () => {
      expect(typeof addBlockedWordSchema.body?.safeParse).toBe('function');
      expect(typeof addBlockedWordsBulkSchema.body?.safeParse).toBe('function');
      expect(addBlockedWordSchema.safeParse).toBeUndefined();
    });

    it('validates single blocked word schema', () => {
      const valid = addBlockedWordSchema.body.safeParse({
        word: 'unacceptable',
        language: 'en',
        category: 'INSULT',
        severity: 'HIGH',
      });
      expect(valid.success).toBe(true);
    });

    it('rejects word shorter than 2 chars', () => {
      const invalid = addBlockedWordSchema.body.safeParse({
        word: 'x',
      });
      expect(invalid.success).toBe(false);
    });

    it('validates bulk blocked words schema', () => {
      const valid = addBlockedWordsBulkSchema.body.safeParse({
        words: [
          { word: 'wordone', severity: 'LOW' },
          { word: 'wordtwo', category: 'PROFANITY' },
        ],
      });
      expect(valid.success).toBe(true);
    });

    it('normalizes word casing to lowercase (scanner matching depends on this running)', () => {
      const result = addBlockedWordSchema.body.safeParse({ word: 'MixedCase' });
      expect(result.success).toBe(true);
      expect(result.data.word).toBe('mixedcase');
    });

    it('enforces the 100-word cap on bulk requests', () => {
      const words = Array.from({ length: 101 }, (_, i) => ({ word: `word${i}` }));
      const result = addBlockedWordsBulkSchema.body.safeParse({ words });
      expect(result.success).toBe(false);
    });
  });

  describe('Service — In-memory caching with TTL', () => {
    it('caches active words and refreshes on invalidation', async () => {
      const mockWords = [
        { id: '1', word: 'cachedword', language: 'en', category: 'PROFANITY', severity: 'MEDIUM' },
      ];
      const spy = jest.spyOn(blockedWordRepository, 'findAllActiveWords').mockResolvedValue(mockWords);

      const words1 = await moderationService.getActiveBlockedWords();
      expect(words1).toEqual(mockWords);
      expect(spy).toHaveBeenCalledTimes(1);

      // Second call uses cache
      const words2 = await moderationService.getActiveBlockedWords();
      expect(words2).toEqual(mockWords);
      expect(spy).toHaveBeenCalledTimes(1);

      // Invalidation forces re-fetch
      moderationService.invalidateBlockedWordsCache();
      const words3 = await moderationService.getActiveBlockedWords();
      expect(words3).toEqual(mockWords);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
