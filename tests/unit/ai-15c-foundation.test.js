/**
 * Phase 15C Step 2 — Foundation tests.
 *
 * Covers:
 * 1. AiMessage model: image-related fields exist and default correctly.
 * 2. Refusal templates: NON_GARMENT_IMAGE category and bilingual messages.
 * 3. Complementary slots: deriveComplementarySlots mappings and fallback.
 */

/* global describe, it, expect */

// ───── 1. AiMessage model fields ───────────────────────────────────────────

import AiMessage from '../../src/modules/ai/conversation/ai-message.model.js';

describe('AiMessage — Phase 15C image fields', () => {
  const paths = AiMessage.schema.paths;

  const IMAGE_FIELDS = [
    'imageRef',
    'imageUrl',
    'imageAnalysis',
    'imageExpiresAt',
    'matchedWardrobeItemId',
    'savedWardrobeItemId',
  ];

  it.each(IMAGE_FIELDS)('schema defines the field "%s"', (field) => {
    expect(paths[field]).toBeDefined();
  });

  it('imageRef defaults to null and is a String', () => {
    expect(paths.imageRef.instance).toBe('String');
    expect(paths.imageRef.defaultValue).toBeNull();
  });

  it('imageUrl defaults to null and is a String', () => {
    expect(paths.imageUrl.instance).toBe('String');
    expect(paths.imageUrl.defaultValue).toBeNull();
  });

  it('imageAnalysis defaults to null and is Mixed', () => {
    expect(paths.imageAnalysis.instance).toBe('Mixed');
    expect(paths.imageAnalysis.defaultValue).toBeNull();
  });

  it('imageExpiresAt defaults to null and is a Date', () => {
    expect(paths.imageExpiresAt.instance).toBe('Date');
    expect(paths.imageExpiresAt.defaultValue).toBeNull();
  });

  it('matchedWardrobeItemId defaults to null and refs WardrobeItem', () => {
    expect(paths.matchedWardrobeItemId.instance).toBe('ObjectId');
    expect(paths.matchedWardrobeItemId.options.ref).toBe('WardrobeItem');
    expect(paths.matchedWardrobeItemId.defaultValue).toBeNull();
  });

  it('savedWardrobeItemId defaults to null and refs WardrobeItem', () => {
    expect(paths.savedWardrobeItemId.instance).toBe('ObjectId');
    expect(paths.savedWardrobeItemId.options.ref).toBe('WardrobeItem');
    expect(paths.savedWardrobeItemId.defaultValue).toBeNull();
  });

  it('has a partial index on imageExpiresAt for the cleanup sweep', () => {
    const indexes = AiMessage.schema.indexes();
    const sweepIndex = indexes.find(
      ([fields]) => fields.imageExpiresAt !== undefined
    );
    expect(sweepIndex).toBeDefined();
    expect(sweepIndex[1]).toHaveProperty('partialFilterExpression');
    expect(sweepIndex[1].partialFilterExpression).toMatchObject({
      imageExpiresAt: { $exists: true },
    });
  });

  it('preserves all original fields (conversationId, role, content, structuredResult, traceId)', () => {
    expect(paths.conversationId).toBeDefined();
    expect(paths.role).toBeDefined();
    expect(paths.content).toBeDefined();
    expect(paths.structuredResult).toBeDefined();
    expect(paths.traceId).toBeDefined();
  });
});

// ───── 2. Refusal templates ────────────────────────────────────────────────

import {
  REFUSAL_CATEGORIES,
  REFUSAL_TEMPLATES,
  getRefusalMessage,
} from '../../src/modules/ai/prompts/refusal.templates.js';

describe('Refusal templates — NON_GARMENT_IMAGE category', () => {
  it('REFUSAL_CATEGORIES includes NON_GARMENT_IMAGE', () => {
    expect(REFUSAL_CATEGORIES.NON_GARMENT_IMAGE).toBe('non_garment_image');
  });

  it('REFUSAL_TEMPLATES has en and ar strings for non_garment_image', () => {
    const tpl = REFUSAL_TEMPLATES[REFUSAL_CATEGORIES.NON_GARMENT_IMAGE];
    expect(tpl).toBeDefined();
    expect(typeof tpl.en).toBe('string');
    expect(typeof tpl.ar).toBe('string');
    expect(tpl.en.length).toBeGreaterThan(20);
    expect(tpl.ar.length).toBeGreaterThan(20);
  });

  it('getRefusalMessage returns English non_garment_image template', () => {
    const msg = getRefusalMessage('non_garment_image', 'en');
    expect(msg).toContain('clothing');
  });

  it('getRefusalMessage returns Arabic non_garment_image template', () => {
    const msg = getRefusalMessage('non_garment_image', 'ar');
    expect(msg).toContain('ملابس');
  });

  it('preserves all original 5 categories', () => {
    expect(REFUSAL_CATEGORIES.GENERAL_KNOWLEDGE).toBe('general_knowledge');
    expect(REFUSAL_CATEGORIES.OTHER_DOMAIN).toBe('other_domain');
    expect(REFUSAL_CATEGORIES.UNSAFE).toBe('unsafe');
    expect(REFUSAL_CATEGORIES.RATE_LIMITED).toBe('rate_limited');
    expect(REFUSAL_CATEGORIES.INVALID_INPUT).toBe('invalid_input');
  });

  it('total categories count is 6 (5 original + 1 new)', () => {
    expect(Object.keys(REFUSAL_CATEGORIES)).toHaveLength(6);
    expect(Object.keys(REFUSAL_TEMPLATES)).toHaveLength(6);
  });
});

// ───── 3. Complementary slots ──────────────────────────────────────────────

import { deriveComplementarySlots } from '../../src/common/constants/dress-code.constant.js';

describe('deriveComplementarySlots', () => {
  it('top → bottom, shoes, outerwear, accessory', () => {
    expect(deriveComplementarySlots('top')).toEqual([
      'bottom', 'shoes', 'outerwear', 'accessory',
    ]);
  });

  it('bottom → top, shoes, outerwear, accessory', () => {
    expect(deriveComplementarySlots('bottom')).toEqual([
      'top', 'shoes', 'outerwear', 'accessory',
    ]);
  });

  it('dress → shoes, outerwear, accessory', () => {
    expect(deriveComplementarySlots('dress')).toEqual([
      'shoes', 'outerwear', 'accessory',
    ]);
  });

  it('shoes → top, bottom, outerwear, accessory', () => {
    expect(deriveComplementarySlots('shoes')).toEqual([
      'top', 'bottom', 'outerwear', 'accessory',
    ]);
  });

  it('outerwear → top, bottom, shoes, accessory', () => {
    expect(deriveComplementarySlots('outerwear')).toEqual([
      'top', 'bottom', 'shoes', 'accessory',
    ]);
  });

  it('accessory → top, bottom, shoes', () => {
    expect(deriveComplementarySlots('accessory')).toEqual([
      'top', 'bottom', 'shoes',
    ]);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(deriveComplementarySlots('  TOP  ')).toEqual([
      'bottom', 'shoes', 'outerwear', 'accessory',
    ]);
    expect(deriveComplementarySlots('Dress')).toEqual([
      'shoes', 'outerwear', 'accessory',
    ]);
  });

  it('falls back to [top, bottom, shoes] for unknown category', () => {
    expect(deriveComplementarySlots('hat')).toEqual(['top', 'bottom', 'shoes']);
    expect(deriveComplementarySlots('unknown')).toEqual(['top', 'bottom', 'shoes']);
  });

  it('falls back for null/undefined/empty input', () => {
    expect(deriveComplementarySlots(null)).toEqual(['top', 'bottom', 'shoes']);
    expect(deriveComplementarySlots(undefined)).toEqual(['top', 'bottom', 'shoes']);
    expect(deriveComplementarySlots('')).toEqual(['top', 'bottom', 'shoes']);
  });

  it('falls back for non-string input', () => {
    expect(deriveComplementarySlots(123)).toEqual(['top', 'bottom', 'shoes']);
    expect(deriveComplementarySlots({})).toEqual(['top', 'bottom', 'shoes']);
  });
});
