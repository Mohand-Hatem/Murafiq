/**
 * Phase 15E — External Product Search Service (product-search.service.js).
 *
 * Implements gap-closing product search using Google Search Grounding with Gemini 3.1 Flash Lite.
 * Integrates 24-hour Redis caching (ai:product-search:{season}:{gender}:{queryHash})
 * and citation extraction to return cited, purchasable external garment recommendations.
 */

import crypto from 'crypto';
import * as llmProvider from '../providers/llm.provider.js';
import { getRedisClient, isRedisConnected } from '../../../config/redis.config.js';
import { logger } from '../../../config/logger.config.js';

export const CACHE_TTL_SECONDS = 86_400; // 24 hours

export const PRODUCT_SEARCH_RESPONSE_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          itemType: { type: 'STRING' },
          slot: {
            type: 'STRING',
            enum: ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'],
          },
          description: { type: 'STRING' },
          estimatedPriceEgp: { type: 'NUMBER' },
          retailer: { type: 'STRING' },
          sourceUrl: { type: 'STRING' },
          sourceTitle: { type: 'STRING' },
          imageUrl: { type: 'STRING' },
          searchQueryUsed: { type: 'STRING' },
        },
        required: ['title', 'itemType', 'slot', 'description'],
      },
    },
    rationale: { type: 'STRING' },
  },
  required: ['suggestions'],
});

const KNOWN_RETAILERS = [
  { match: /zara/i, title: 'Zara Egypt' },
  { match: /massimo\s*dutti/i, title: 'Massimo Dutti Egypt' },
  { match: /h&m|h\s*and\s*m/i, title: 'H&M Egypt' },
  { match: /amazon/i, title: 'Amazon Egypt' },
  { match: /mango/i, title: 'Mango Egypt' },
  { match: /defacto/i, title: 'DeFacto Egypt' },
  { match: /town\s*team/i, title: 'Town Team' },
  { match: /tie\s*house/i, title: 'Tie House' },
  { match: /concrete/i, title: 'Concrete Egypt' },
];

export const getKnownRetailerInfo = (retailerName = '') => {
  const str = String(retailerName || '').trim();
  if (!str) return null;
  const found = KNOWN_RETAILERS.find((r) => r.match.test(str));
  return found ? { title: found.title } : null;
};

// Generic stock photography and placeholder domains to strictly reject
export const STOCK_AND_PLACEHOLDER_DOMAINS = Object.freeze([
  'unsplash.com',
  'images.unsplash.com',
  'pexels.com',
  'images.pexels.com',
  'shutterstock.com',
  'gettyimages.com',
  'istockphoto.com',
  'stock.adobe.com',
  'alamy.com',
  'depositphotos.com',
  'dreamstime.com',
  'placehold.co',
  'via.placeholder.com',
  'placeholder.com',
  'dummyimage.com',
  'lorempixel.com',
  'picsum.photos',
]);

// Garment categories mapping for cross-category conflict detection
const GARMENT_CATEGORY_TERMS = {
  shoes: ['shoes', 'shoe', 'oxford', 'oxfords', 'loafer', 'loafers', 'sneaker', 'sneakers', 'boot', 'boots', 'derby', 'derbies', 'heel', 'heels', 'sandals', 'footwear'],
  top: ['shirt', 'shirts', 'tshirt', 't-shirt', 'blouse', 'polo', 'sweater', 'pullover', 'cardigan', 'hoodie', 'top', 'turtleneck'],
  bottom: ['trousers', 'pants', 'jeans', 'chino', 'chinos', 'shorts', 'skirt', 'slacks'],
  outerwear: ['blazer', 'coat', 'jacket', 'tuxedo', 'suit', 'overcoat', 'parka', 'trench'],
  dress: ['dress', 'gown', 'frock', 'jumpsuit'],
  accessory: ['tie', 'bow-tie', 'belt', 'watch', 'cufflinks', 'scarf', 'bag', 'pocket-square'],
};

/**
 * Validates whether a URL is an exact verified direct product page.
 * Rejects homepages, category pages, search results, utility pages, and wrong product pages.
 *
 * @param {string} rawUrl
 * @param {Object} [item={}] - The recommended item { title, itemType, slot, retailer }
 * @param {Array} [citations=[]] - Grounding citations returned from Google Search
 * @returns {string|null}
 */
export const verifyDirectProductUrl = (rawUrl, item = {}, citations = []) => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // 1. Protocol validation: must be http or https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  // 2. Domain validation: reject localhost, bare IP addresses, or non-FQDN
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.includes('.') || hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return null;
  }

  const pathname = parsed.pathname.trim().toLowerCase();

  // 3. Reject root, home, index, default, or locale-only roots
  // Matches /, /en-eg, /en_eg, /en_eg/, /en-eg/, /eg/, /en/, /ar/, /home, /default, /index.html, /en_eg/index.html, /home.html, /default.html, etc.
  const isHomepageOrLocaleRoot =
    /^\/?$/i.test(pathname) ||
    /^\/([a-z]{2}([-_][a-z]{2})?)?\/?(index|home|default)?(\.[a-z0-9]+)?\/?$/i.test(pathname) ||
    /\/(index|home|default)\.[a-z0-9]+$/i.test(pathname);

  if (isHomepageOrLocaleRoot) {
    return null;
  }

  // 4. Reject search / find / catalogsearch URLs
  if (/\/(search|find|catalogsearch|browse|query)(\/|$)/i.test(pathname)) {
    return null;
  }
  const searchParamNames = ['q', 'query', 'search', 'k', 'keyword', 'searchTerm'];
  for (const param of searchParamNames) {
    if (parsed.searchParams.has(param)) {
      return null;
    }
  }

  // 5. Reject generic utility / checkout / cart / account pages
  if (/\/(cart|checkout|bag|account|login|signin|register|contact|about|terms|privacy|help|faq)(\/|$)/i.test(pathname)) {
    return null;
  }

  // 6. Explicitly reject category codes like -c358017.html or /c/ paths
  if (/-(c\d+|cat\d+)\.html$/i.test(pathname) || /^\/c\/[a-z0-9-]+$/i.test(pathname)) {
    return null;
  }

  // 7. Require a concrete product-page indicator or a sufficiently deep product slug
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] || '';

  const hasProductIndicator =
    /\/(products?|p|dp|item|pd)\//i.test(pathname) ||
    /-(p\d+|l\d+|sku\d+)\.html$/i.test(pathname) ||
    /productpage\.\d+/i.test(pathname) ||
    /buy-[a-z0-9-]+/i.test(pathname) ||
    /\/\d{6,}(\.html)?$/i.test(pathname) ||
    (lastSegment.endsWith('.html') && lastSegment.length > 10 && lastSegment.includes('-'));

  if (!hasProductIndicator) {
    return null;
  }

  // 8. Reject generic category / collection / department pages
  const isGenericCategory =
    /^\/(collections?|categories|category|department|all|shop|clothing)(\/[a-z0-9_-]+)*\/?$/i.test(pathname) ||
    /^\/([a-z]{2}([-_][a-z]{2})?)?\/?(men|women|kids)\/(shoes|clothing|accessories|bottoms|tops|sale)\/?$/i.test(pathname);

  if (isGenericCategory) {
    return null;
  }

  // 9. Product Correspondence / Conflict Check
  const targetSlot = String(item.slot || '').toLowerCase();
  const itemText = `${item.title || ''} ${item.itemType || ''}`.toLowerCase();
  const citationForUrl = citations.find((c) => c.url === trimmed);
  const urlAndCitationText = `${pathname} ${parsed.search} ${citationForUrl?.title || ''}`.toLowerCase();

  for (const [slot, terms] of Object.entries(GARMENT_CATEGORY_TERMS)) {
    if (slot !== targetSlot) {
      const isItemInThisSlot = terms.some((t) => itemText.includes(t));
      if (!isItemInThisSlot) {
        const targetTerms = GARMENT_CATEGORY_TERMS[targetSlot] || [];
        const urlHasOtherCategory = terms.some((t) => urlAndCitationText.includes(t));
        const urlHasTargetCategory = targetTerms.some((t) => urlAndCitationText.includes(t));
        if (urlHasOtherCategory && !urlHasTargetCategory && targetTerms.length > 0) {
          return null; // Product mismatch / wrong product page!
        }
      }
    }
  }

  return parsed.href;
};

/**
 * Validates whether an image URL is an exact verified direct product image.
 * Rejects stock photos, placeholders, lookbook/campaign/editorial images, and mismatched garment images.
 * If verifiedSourceUrl is absent or rejected, image URL is ungrounded and rejected.
 *
 * @param {string} rawImageUrl
 * @param {Object} [item={}]
 * @param {string|null} [verifiedSourceUrl=null]
 * @returns {string|null}
 */
export const verifyProductImageUrl = (rawImageUrl, item = {}, verifiedSourceUrl = null) => {
  if (!rawImageUrl || typeof rawImageUrl !== 'string') return null;
  const trimmed = rawImageUrl.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  // If the associated sourceUrl is rejected or missing, do not retain an ungrounded image
  if (!verifiedSourceUrl || typeof verifiedSourceUrl !== 'string') {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // 1. Protocol validation: must be http or https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  // 2. Reject stock photography and placeholder domains
  const hostname = parsed.hostname.toLowerCase();
  const isStockOrPlaceholder = STOCK_AND_PLACEHOLDER_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
  if (isStockOrPlaceholder) {
    return null;
  }

  // 3. Reject generic placeholder, icon, banner, logo, lookbook, campaign, and editorial images
  const fullImgTarget = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  const isRejectedPattern =
    /lookbook|campaign|editorial|placeholder|default[-_]?image|no[-_]?image|missing[-_]?image|banner|logo|avatar|icon|fallback|\.svg$/i.test(
      fullImgTarget
    );
  if (isRejectedPattern) {
    return null;
  }

  // 4. Check for conflicting SKU if both image and sourceUrl have distinct product identifiers
  const sourceSkuMatch = verifiedSourceUrl.match(/[-_]p?(\d{5,})/i);
  const imgSkuMatch = (parsed.pathname + parsed.search).match(/[-_/]p?(\d{5,})/i);
  if (sourceSkuMatch && imgSkuMatch && sourceSkuMatch[1] !== imgSkuMatch[1]) {
    // Both define an explicit multi-digit SKU and they do not match
    // Check if source SKU digits are contained in the image path (e.g. 02761045 vs 2761045)
    const sDigits = sourceSkuMatch[1].replace(/^0+/, '');
    const iDigits = imgSkuMatch[1].replace(/^0+/, '');
    if (sDigits !== iDigits && !iDigits.includes(sDigits) && !sDigits.includes(iDigits)) {
      return null; // Mismatched product image / SKU
    }
  }

  // 5. Product Correspondence / Conflict Check
  const targetSlot = String(item.slot || '').toLowerCase();
  const itemText = `${item.title || ''} ${item.itemType || ''}`.toLowerCase();
  const imgUrlText = `${parsed.pathname} ${parsed.search}`.toLowerCase();

  for (const [slot, terms] of Object.entries(GARMENT_CATEGORY_TERMS)) {
    if (slot !== targetSlot) {
      const isItemInThisSlot = terms.some((t) => itemText.includes(t));
      if (!isItemInThisSlot) {
        const targetTerms = GARMENT_CATEGORY_TERMS[targetSlot] || [];
        const imgHasOtherCategory = terms.some((t) => imgUrlText.includes(t));
        const imgHasTargetCategory = targetTerms.some((t) => imgUrlText.includes(t));
        if (imgHasOtherCategory && !imgHasTargetCategory && targetTerms.length > 0) {
          return null; // Product mismatch / wrong product image!
        }
      }
    }
  }

  return parsed.href;
};

// Mock/test overrides
let redisOverride = null;
let isConnectedOverride = null;
const inMemoryProductCache = new Map();

/**
 * Injects a mock Redis client for isolated unit testing.
 * @param {Object|null} client
 * @param {Function|null} isConnFn
 */
export const setProductSearchRedisOverride = (client, isConnFn = null) => {
  redisOverride = client;
  isConnectedOverride = isConnFn;
};

/**
 * Clears the in-memory fallback cache (for testing).
 */
export const clearInMemoryProductCache = () => {
  inMemoryProductCache.clear();
};

const resolveRedisClient = () => redisOverride || getRedisClient();
const resolveIsConnected = () =>
  isConnectedOverride ? isConnectedOverride() : isRedisConnected();

/**
 * Computes a deterministic normalized 24-hour Redis cache key for product searches.
 *
 * @param {string} query
 * @param {Object} [options={}]
 * @param {string} [options.season='all']
 * @param {string} [options.genderPresentation='unisex']
 * @returns {string}
 */
export const computeCacheKey = (
  query,
  { season = 'all', genderPresentation = 'unisex', locale = 'en' } = {}
) => {
  const normQuery = String(query || '').toLowerCase().trim();
  const normSeason = String(season || 'all').toLowerCase().trim();
  const normGender = String(genderPresentation || 'unisex').toLowerCase().trim();
  const normLocale = String(locale || 'en').toLowerCase().trim();
  const queryHash = crypto.createHash('sha256').update(normQuery).digest('hex').slice(0, 16);

  return `ai:product-search:${normSeason}:${normGender}:${normLocale}:${queryHash}`;
};

/**
 * Executes an external product search using Google Search Grounding to close wardrobe gaps.
 *
 * @param {Object} params
 * @param {string} params.gapDescription - Concrete missing item description (e.g. "navy formal trousers")
 * @param {Array<Object>} [params.gapItems=[]] - Structured gap items
 * @param {string} [params.occasion='formal'] - Event/occasion context
 * @param {string} [params.formality='formal'] - Dress code formality
 * @param {string} [params.season='all'] - Season context
 * @param {string} [params.genderPresentation='unisex'] - Target gender presentation
 * @param {'ar'|'en'} [params.locale='en'] - Output language
 * @param {number} [params.budget] - Optional budget in EGP
 * @returns {Promise<Array<Object>>} Array of acquisition suggestions with citations
 */
export const searchExternalProducts = async ({
  gapDescription,
  gapItems = [],
  occasion = 'formal',
  formality = 'formal',
  season = 'all',
  genderPresentation = 'unisex',
  locale = 'en',
  budget,
} = {}) => {
  const query = String(gapDescription || '').trim();
  if (!query) {
    return [];
  }

  const cacheKey = computeCacheKey(query, { season, genderPresentation, locale });

  // 1. Check 24-hour Redis Cache
  try {
    if (resolveIsConnected()) {
      const redis = resolveRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.map((item) => ({ ...item, cacheHit: true }));
      }
    } else {
      const memCached = inMemoryProductCache.get(cacheKey);
      if (memCached && memCached.expiresAt > Date.now()) {
        return memCached.suggestions.map((item) => ({ ...item, cacheHit: true }));
      }
    }
  } catch (cacheErr) {
    logger.warn(`[ProductSearch] Cache read failed for key ${cacheKey}:`, cacheErr.message);
  }

  // 2. Perform Grounded Product Search using Gemini 3.1 Flash Lite + Google Search Tool
  const langPrompt =
    locale === 'ar'
      ? 'CRITICAL ARABIC REQUIREMENT: The user speaks Arabic. You MUST formulate the response entirely in elegant, modern Arabic (العربية). All product titles (title), item types (itemType), detailed styling descriptions (description), and retailer names or translations MUST be in Arabic. Do not output English words unless referring to international brand names.'
      : 'Write product titles, descriptions, and rationales in fluent, elegant English.';

  const systemPrompt = `You are the Murafiq Senior Fashion Personal Shopper and Acquisition Assistant.
Your duty is to recommend real, purchasable clothing and footwear pieces available for the Egyptian market (Cairo, Alexandria, online retail in Egypt) to close specific wardrobe gaps for clients.
Focus on prominent retailers and brands in Egypt (e.g. Zara Egypt, Amazon Egypt, H&M Egypt, Massimo Dutti Egypt, localized luxury boutiques).

TWO-SUGGESTION RULE:
- Generate up to 2 distinct acquisition suggestions representing different aesthetic choices or price alternatives.
- Each suggestion must specify:
  * slot: garment category (top, bottom, shoes, outerwear, accessory, dress)
  * itemType: specific fashion garment type
  * title: exact descriptive title
  * retailer: retailer name in Egypt
  * estimatedPriceEgp: estimated price in EGP
  * sourceUrl: exact verified direct product page/purchase URL found in search results (e.g. https://www.zara.com/eg/en/wool-trousers-p12345.html). Return null if no exact direct product page is found. NEVER provide a retailer homepage, category page, or search page.
  * sourceTitle: store product title
  * imageUrl: exact verified product image URL found in search results or metadata. Return null if no exact verified product image is found. NEVER invent an image URL, never use Unsplash/stock photography, and never use placeholder images.
  * description: detailed styling description.
- Never duplicate products or suggest identical items under different names.

${langPrompt}`;

  const budgetClause = budget ? ` Target Budget: ~${budget} EGP.` : '';
  const gapContext =
    Array.isArray(gapItems) && gapItems.length > 0
      ? `\nSpecific Missing Gaps: ${gapItems.map((g) => `${g.slot}: ${g.description || g.slot}`).join(', ')}`
      : '';
  const langClause =
    locale === 'ar'
      ? '\nRequired Language: Arabic (أجب باللغة العربية حصراً لجميع الحقول).'
      : '';

  const userParts = `Search for purchasable fashion items in Egypt for:
Target Gap: ${query}${gapContext}
Occasion: ${occasion}
Formality: ${formality}
Season: ${season}
Gender Presentation: ${genderPresentation}${budgetClause}${langClause}`;

  let result;
  let isGrounded = true;

  try {
    // Primary execution: Live Google Search Grounding (active for production)
    result = await llmProvider.complete({
      task: 'reasoning',
      systemPrompt,
      userParts,
      responseSchema: PRODUCT_SEARCH_RESPONSE_SCHEMA,
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
      timeoutMs: 25_000,
    });
  } catch (searchErr) {
    logger.warn('[ProductSearch] Grounded search execution failed, falling back to ungrounded LLM recommendations:', searchErr.message);
    isGrounded = false;

    try {
      // Resilient fallback: Query Gemini without search tool to close gaps with real items & prices
      result = await llmProvider.complete({
        task: 'reasoning',
        systemPrompt,
        userParts,
        responseSchema: PRODUCT_SEARCH_RESPONSE_SCHEMA,
        tools: null,
        temperature: 0.2,
        timeoutMs: 15_000,
      });
    } catch (fallbackErr) {
      logger.error('[ProductSearch] Fallback ungrounded search failed:', fallbackErr.message);
      return [];
    }
  }

  // 3. Extract Citations & Map to Suggestions with Strict Grounding & Association
  const groundingMetadata = result?.groundingMetadata || {};
  const chunks = Array.isArray(groundingMetadata.groundingChunks)
    ? groundingMetadata.groundingChunks
    : [];

  const citations = chunks
    .map((chunk) => {
      const uri = chunk.web?.uri;
      const title = chunk.web?.title || 'Web Retailer';
      return uri ? { title, url: uri } : null;
    })
    .filter(Boolean);

  const rawSuggestions = Array.isArray(result?.data?.suggestions)
    ? result.data.suggestions.slice(0, 2)
    : [];

  const suggestions = rawSuggestions.map((s, index) => {
    const primaryCitation = citations[index] || citations[0] || null;
    const knownRetailer = getKnownRetailerInfo(s.retailer);

    // Evaluate candidate product URLs in order: primary citation from grounding, then candidate sourceUrl
    const candidateUrls = [primaryCitation?.url, s.sourceUrl].filter(Boolean);
    let resolvedUrl = null;
    let resolvedTitle = null;

    for (const candUrl of candidateUrls) {
      const verified = verifyDirectProductUrl(candUrl, s, citations);
      if (verified) {
        resolvedUrl = verified;
        resolvedTitle =
          (candUrl === primaryCitation?.url ? primaryCitation?.title : s.sourceTitle) ||
          knownRetailer?.title ||
          s.retailer ||
          null;
        break;
      }
    }

    // Verify candidate product image URL with strict anti-fabrication / anti-stock rules
    const resolvedImageUrl = verifyProductImageUrl(s.imageUrl, s, resolvedUrl);

    const itemCitations = citations.length > 0
      ? citations
      : (resolvedUrl ? [{ title: resolvedTitle || 'Retailer', url: resolvedUrl }] : []);

    return {
      slot: s.slot || 'accessory',
      itemType: s.itemType || s.title || 'Fashion Garment',
      title: s.title || 'Suggested Piece',
      description: s.description || '',
      estimatedPriceEgp: typeof s.estimatedPriceEgp === 'number' ? s.estimatedPriceEgp : null,
      retailer: s.retailer || resolvedTitle || 'Online Retailer',
      sourceUrl: resolvedUrl,
      sourceTitle: resolvedTitle,
      imageUrl: resolvedImageUrl,
      citations: itemCitations,
      isGrounded: Boolean(isGrounded && primaryCitation?.url && resolvedUrl),
      cacheHit: false,
    };
  });

  // 4. Cache in 24-hour Redis Store
  if (suggestions.length > 0) {
    try {
      if (resolveIsConnected()) {
        const redis = resolveRedisClient();
        await redis.set(cacheKey, JSON.stringify(suggestions), 'EX', CACHE_TTL_SECONDS);
      } else {
        inMemoryProductCache.set(cacheKey, {
          suggestions,
          expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
        });
      }
    } catch (cacheSetErr) {
      logger.warn(`[ProductSearch] Cache write failed for key ${cacheKey}:`, cacheSetErr.message);
    }
  }

  return suggestions;
};

export default {
  CACHE_TTL_SECONDS,
  PRODUCT_SEARCH_RESPONSE_SCHEMA,
  STOCK_AND_PLACEHOLDER_DOMAINS,
  getKnownRetailerInfo,
  verifyDirectProductUrl,
  verifyProductImageUrl,
  setProductSearchRedisOverride,
  clearInMemoryProductCache,
  computeCacheKey,
  searchExternalProducts,
};
