import * as llmProvider from '../providers/llm.provider.js';
import { getLocalizedGapDescription } from './render.step.js';

export const COMPOSE_RESPONSE_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    outfits: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          itemIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          rationale: { type: 'STRING' },
          score: { type: 'NUMBER' },
        },
        required: ['itemIds', 'rationale', 'score'],
      },
    },
    sufficiency: {
      type: 'STRING',
      enum: ['good', 'partial', 'none'],
    },
    missingSlots: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    gapDescriptions: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['outfits', 'sufficiency', 'missingSlots'],
});

const formatCandidateItem = (item) => {
  const id = item._id ? item._id.toString() : String(item.id || '');
  const category = item.category || 'unknown';
  const subcategory = item.subcategory ? ` (${item.subcategory})` : '';
  const name = item.name ? ` "${item.name}"` : '';
  const color = item.primaryColor || 'unspecified';
  const formality = item.formality || 'unspecified';
  const material = item.material ? `, Material: ${item.material}` : '';
  const desc = item.aiDescription ? ` | Desc: "${item.aiDescription}"` : '';

  return `- ID: "${id}" | Category: ${category}${subcategory}${name} | Color: ${color} | Formality: ${formality}${material}${desc}`;
};

export const buildSystemPrompt = (
  language = 'en',
  hasAnchor = false,
  fashionKnowledgeChunks = []
) => {
  const langInstruction =
    language === 'ar'
      ? 'CRITICAL: Write all outfit rationales in natural, elegant, modern Arabic (عربي). Every string in "rationale" and "gapDescriptions" MUST be in Arabic.'
      : 'CRITICAL: Write all outfit rationales in fluent, professional English. All rationales and gapDescriptions must be in professional English.';

  const anchorInstruction = hasAnchor
    ? `\n7. ANCHOR GARMENT INVARIANT: The user uploaded an anchor garment photograph. You MUST build every composed outfit around this anchor piece and include its exact ID in the "itemIds" array of every outfit. Select complementary pieces from the wardrobe candidates to complete the look around this anchor.`
    : '';

  const knowledgeSection =
    Array.isArray(fashionKnowledgeChunks) && fashionKnowledgeChunks.length > 0
      ? `\n\n<fashion_editorial_knowledge>\n` +
        fashionKnowledgeChunks
          .map((c) => `### ${c.title}\n${c.body}`)
          .join('\n\n') +
        `\n</fashion_editorial_knowledge>\n\nEDITORIAL ADVISORY GUIDELINES: Use the verified editorial knowledge above to inform dress code standards, color harmonies, fabric appropriateness, and cultural decorum. This knowledge provides authoritative styling context, but you MUST still select 'itemIds' EXCLUSIVELY from the supplied wardrobe candidates (or anchor garment).`
      : '';

  return `You are the Murafiq AI Senior Fashion Stylist.
Your duty is to compose and rank complete, stylish, occasion-appropriate outfits exclusively using the candidate garments provided from the client's wardrobe.

STRICT INVARIANTS:
1. CANDIDATE PROVENANCE: Every "itemIds" array MUST contain ONLY exact string IDs from the provided candidate list (or the anchor garment ID if provided). Never fabricate, guess, or modify an ID.
2. A complete outfit must cover the required slots (either top + bottom + shoes, or dress + shoes, plus appropriate outerwear/accessories if needed).
3. ELEGANCE & COLOR HARMONY: Combine pieces that complement each other in silhouette, formality, color palette, and season. Respect the user's style preferences and color restrictions.
4. TWO-SUGGESTION RULE & RANKING: Propose up to 2 distinct ranked outfits (aim for 2 distinct styling directions or silhouettes when wardrobe candidates permit). Assign a compatibility score from 0 to 100 for each outfit based on aesthetic synergy and dress code fit. Never duplicate item combinations.
5. SUFFICIENCY EVALUATION:
   - 'good': The client's wardrobe provides complete, well-fitting, high-scoring outfits. Return up to 2 distinct outfits in "outfits".
   - 'partial': Complete base looks are possible, but missing key complementary or elevating pieces (e.g. jacket, tie, accessories, proper dress shoes). Return the best available partial outfit(s).
   - 'none': The wardrobe candidates cannot fulfill the occasion's dress code adequately. Return an empty "outfits" array [].
6. GAP ANALYSIS & CONCRETE DESCRIPTIONS:
   - In "missingSlots", list generic garment categories missing (e.g. "shoes", "outerwear", "accessory", "bottom").
   - In "gapDescriptions", when sufficiency is 'partial' or 'none', formulate concrete, specific, purchasable garment gap descriptions tailored to the event dress code, formality, season, and Egyptian styling context (e.g. "navy formal tailored trousers", "crisp white poplin dress shirt", "black polished leather oxford shoes", "charcoal wool single-breasted blazer"). Never use generic one-word descriptions like "bottoms" or "shoes". If sufficiency is 'good', return an empty array [].${anchorInstruction}
${knowledgeSection}

${langInstruction}`;
};

/**
 * Composes and ranks outfits from available wardrobe candidate items.
 *
 * @param {Object} params
 * @param {Object} params.candidatesBySlot - Grouped candidate items by category
 * @param {Object} [params.resolvedDressCode={}] - Deterministic dress code rules
 * @param {Object} [params.preferences={}] - User style preferences
 * @param {Object} [params.eventContext={}] - Extracted event context (season, timeOfDay, etc.)
 * @param {Object} [params.anchor=null] - Optional uploaded anchor garment to thread through outfits
 * @param {Array} [params.fashionKnowledgeChunks=[]] - Retrieved editorial knowledge chunks for RAG grounding
 * @param {'ar'|'en'} [params.language='en'] - Output language for rationales
 * @param {Object} [params.options={}]
 * @returns {Promise<{
 *   outfits: Array<{ itemIds: string[], rationale: string, score: number }>,
 *   sufficiency: 'good'|'partial'|'none',
 *   missingSlots: string[],
 *   usage: { inputTokens: number, outputTokens: number },
 *   latencyMs: number
 * }>}
 */
export const composeAndRankOutfits = async ({
  candidatesBySlot = {},
  resolvedDressCode = {},
  preferences = {},
  eventContext = {},
  anchor = null,
  fashionKnowledgeChunks = [],
  language = 'en',
  options = {},
}) => {
  const { temperature = 0.2, timeoutMs = 15_000 } = options;

  const candidateSections = Object.entries(candidatesBySlot)
    .filter(([_, items]) => Array.isArray(items) && items.length > 0)
    .map(([slot, items]) => `### Category: ${slot.toUpperCase()}\n${items.map(formatCandidateItem).join('\n')}`)
    .join('\n\n');

  const dressCodeRules = [
    `Event Type: ${resolvedDressCode.eventType || eventContext.eventType || 'General Occasion'}`,
    `Target Gender Presentation: ${eventContext.genderPresentation || 'unisex'}`,
    `Allowed Formalities: ${(resolvedDressCode.formality || ['casual', 'smart_casual']).join(', ')}`,
    `Required Slots: ${(resolvedDressCode.requiredSlots || ['top', 'bottom', 'shoes']).join(', ')}`,
    `Optional Slots: ${(resolvedDressCode.optionalSlots || ['outerwear', 'accessory']).join(', ')}`,
    `Season: ${eventContext.season || 'all'}`,
    `Time of Day: ${eventContext.timeOfDay || 'any'}`,
    `Setting: ${eventContext.setting || 'any'}`,
    `High Stakes Event: ${resolvedDressCode.highStakes ? 'Yes (strict adherence)' : 'No'}`,
  ].join('\n');

  const userPrefs = [
    `Favorite Colors: ${(preferences.favoriteColors || []).join(', ') || 'None specified'}`,
    `Avoided Colors: ${(preferences.avoidedColors || []).join(', ') || 'None specified'}`,
    `Modesty Preference: ${preferences.modestyPreference || 'standard'}`,
    `Disliked Style Tags: ${(preferences.dislikedStyleTags || []).join(', ') || 'None'}`,
    `Special Notes: ${preferences.notes || 'None'}`,
  ].join('\n');

  const anchorId = anchor ? String(anchor.id || 'anchor_item') : null;
  const anchorSection = anchor
    ? `<anchor_garment>
ID: "${anchorId}" | Category: ${anchor.category || 'unknown'}${anchor.subcategory ? ` (${anchor.subcategory})` : ''} | Color: ${anchor.colorFamily || (Array.isArray(anchor.colors) ? anchor.colors.join('/') : 'unspecified')} | Formality: ${anchor.formality || 'unspecified'}${anchor.material ? `, Material: ${anchor.material}` : ''}${anchor.pattern ? `, Pattern: ${anchor.pattern}` : ''}
INSTRUCTION: This anchor garment MUST be included as one of the itemIds in EVERY outfit you compose. Select complementary pieces from the wardrobe candidates to complete the look.
</anchor_garment>\n\n`
    : '';

  const userPrompt = `${anchorSection}<dress_code_rules>
${dressCodeRules}
</dress_code_rules>

<user_style_preferences>
${userPrefs}
</user_style_preferences>

<available_wardrobe_candidates>
${candidateSections || 'No candidates available.'}
</available_wardrobe_candidates>

Compose the best outfits for this occasion strictly using the candidate IDs above${anchor ? ' and the anchor garment' : ''}.`;

  const systemPrompt = buildSystemPrompt(language, Boolean(anchor), fashionKnowledgeChunks);

  const result = await llmProvider.complete({
    task: 'reasoning',
    systemPrompt,
    userParts: [{ text: userPrompt }],
    responseSchema: COMPOSE_RESPONSE_SCHEMA,
    temperature,
    timeoutMs,
  });

  const parsed = result.data || {};

  const outfits = Array.isArray(parsed.outfits)
    ? parsed.outfits.slice(0, 2).map((o) => {
        let itemIds = Array.isArray(o.itemIds) ? o.itemIds.map(String) : [];
        // Anchor Invariant: Pin the anchor garment ID into every returned outfit
        if (anchorId && !itemIds.includes(anchorId)) {
          itemIds.unshift(anchorId);
        }
        return {
          itemIds,
          rationale: String(o.rationale || '').trim(),
          score: typeof o.score === 'number' ? Math.min(100, Math.max(0, o.score)) : 80,
        };
      })
    : [];

  const sufficiency = ['good', 'partial', 'none'].includes(parsed.sufficiency)
    ? parsed.sufficiency
    : outfits.length > 0
    ? 'good'
    : 'none';

  const missingSlots = Array.isArray(parsed.missingSlots) ? parsed.missingSlots.map(String) : [];

  let gapDescriptions = Array.isArray(parsed.gapDescriptions)
    ? parsed.gapDescriptions.map(String).map((s) => s.trim()).filter(Boolean)
    : [];

  // Fallback: If partial or none sufficiency but no gapDescriptions returned, synthesize from missingSlots & formality
  if (gapDescriptions.length === 0 && sufficiency !== 'good' && missingSlots.length > 0) {
    const formalityStr =
      Array.isArray(resolvedDressCode.formality) && resolvedDressCode.formality.length > 0
        ? resolvedDressCode.formality[0]
        : 'formal';
    gapDescriptions = missingSlots.map((slot) =>
      getLocalizedGapDescription(slot, formalityStr, language)
    );
  }

  return {
    outfits,
    sufficiency,
    missingSlots,
    gapDescriptions,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
};

export default {
  COMPOSE_RESPONSE_SCHEMA,
  composeAndRankOutfits,
};
