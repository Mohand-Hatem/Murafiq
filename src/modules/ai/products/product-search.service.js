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
import { getShoppingProvider } from '../providers/shopping/shopping-provider.factory.js';

export const CACHE_TTL_SECONDS = 86_400; // 24 hours

export const SEARCH_PLANNER_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    queries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          slot: {
            type: 'STRING',
            enum: ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'],
          },
          itemType: { type: 'STRING' },
          searchQuery: {
            type: 'STRING',
            description: 'Focused search query for Egyptian stores, e.g. "قميص رسمي أبيض رجالي" or "بنطال تشينو كحلي رجالي"',
          },
          targetColor: { type: 'STRING' },
          outfitIndex: { type: 'NUMBER' },
          outfitTitle: { type: 'STRING' },
        },
        required: ['slot', 'itemType', 'searchQuery'],
      },
    },
    stylingIntent: { type: 'STRING' },
  },
  required: ['queries'],
});

export const SEARCH_RANKER_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    selectedItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          candidateId: { type: 'STRING' },
          slot: {
            type: 'STRING',
            enum: ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'],
          },
          itemType: { type: 'STRING' },
          customTitle: { type: 'STRING' },
          description: {
            type: 'STRING',
            description: 'Detailed personalized styling explanation in Arabic or English explaining why this piece complements the look',
          },
          outfitIndex: { type: 'NUMBER' },
          outfitTitle: { type: 'STRING' },
        },
        required: ['candidateId', 'description'],
      },
    },
    generalRationale: { type: 'STRING' },
  },
  required: ['selectedItems'],
});

const KNOWN_RETAILERS = [
  { match: /zara/i, title: 'Zara Egypt' },
  { match: /massimo\s*dutti/i, title: 'Massimo Dutti Egypt' },
  { match: /h&m|h\s*and\s*m/i, title: 'H&M Egypt' },
  { match: /amazon/i, title: 'Amazon Egypt' },
  { match: /jumia/i, title: 'Jumia Egypt' },
  { match: /noon/i, title: 'Noon Egypt' },
  { match: /asos/i, title: 'ASOS' },
  { match: /namshi/i, title: 'Namshi' },
  { match: /mango/i, title: 'Mango Egypt' },
  { match: /defacto/i, title: 'DeFacto Egypt' },
  { match: /lc\s*waikiki/i, title: 'LC Waikiki' },
  { match: /pull\s*(&|and)?\s*bear/i, title: 'Pull&Bear' },
  { match: /bershka/i, title: 'Bershka' },
  { match: /stradivarius/i, title: 'Stradivarius' },
  { match: /town\s*team/i, title: 'Town Team' },
  { match: /tie\s*house/i, title: 'Tie House' },
  { match: /concrete/i, title: 'Concrete Egypt' },
  { match: /mobaco/i, title: 'Mobaco Cottons' },
  { match: /dalydress/i, title: 'Dalydress' },
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
    /-(p\d+|sku\d+)\.html$/i.test(pathname) ||
    /productpage\.\d+/i.test(pathname) ||
    /buy-[a-z0-9-]+/i.test(pathname) ||
    /\/\d{6,}(\.html)?$/i.test(pathname) ||
    /-\d{3,}(\.html)?$/i.test(lastSegment) ||
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

  // 4. Check for conflicting SKU if both image and sourceUrl have distinct explicit product identifiers
  const sourceSkuMatch = verifiedSourceUrl.match(/[-_]p?(\d{5,})/i);
  if (sourceSkuMatch) {
    const isZara = verifiedSourceUrl.includes('zara.') && hostname.includes('zara.');
    let imgSkuMatch = null;
    if (isZara) {
      const filename = parsed.pathname.split('/').pop() || '';
      imgSkuMatch = filename.match(/^(\d{5,})/);
    } else {
      imgSkuMatch = (parsed.pathname + parsed.search).match(/[-_](?:p|sku)(\d{5,})/i);
    }

    if (imgSkuMatch && sourceSkuMatch[1] !== imgSkuMatch[1]) {
      const sDigits = sourceSkuMatch[1].replace(/^0+/, '');
      const iDigits = imgSkuMatch[1].replace(/^0+/, '');
      if (sDigits !== iDigits && !iDigits.includes(sDigits) && !sDigits.includes(iDigits)) {
        return null; // Mismatched product image / SKU
      }
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

  // 6. Color Conflict Check (prevents e.g. black garment images on white recommendations)
  const isWhiteItem = /white|أبيض/i.test(itemText);
  const isBlackItem = /black|أسود/i.test(itemText);
  const imgHasBlack = /[-_/]black[-_/\.]/i.test(imgUrlText);
  const imgHasWhite = /[-_/]white[-_/\.]/i.test(imgUrlText);

  if (isWhiteItem && imgHasBlack && !imgHasWhite) {
    return null; // Color mismatch: item is white but image is explicitly black!
  }
  if (isBlackItem && imgHasWhite && !imgHasBlack) {
    return null; // Color mismatch: item is black but image is explicitly white!
  }

  return parsed.href;
};

/**
 * Resolves Google Grounding redirect URLs or follows 302 redirects to destination retailer URLs.
 *
 * @param {string} rawUrl
 * @returns {Promise<string|null>}
 */
export const resolveRedirectUrl = async (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed.includes('vertexaisearch.cloud.google.com')) return trimmed;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(trimmed, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const location = res.headers.get('location');
    return location || trimmed;
  } catch {
    return trimmed;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Lightweight OpenGraph image extractor from an authentic product page.
 *
 * @param {string} pageUrl
 * @returns {Promise<string|null>}
 */
export const extractOgImage = async (pageUrl) => {
  if (!pageUrl || typeof pageUrl !== 'string') return null;
  const trimmed = pageUrl.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(trimmed, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await res.text();
    const match =
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

    if (!match || !match[1]) return null;
    let ogUrl = match[1].trim();
    if (ogUrl.startsWith('//')) {
      ogUrl = `https:${ogUrl}`;
    } else if (ogUrl.startsWith('/')) {
      const parsed = new URL(trimmed);
      ogUrl = `${parsed.origin}${ogUrl}`;
    }
    return ogUrl;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

let liveUrlValidatorOverride = null;

/**
 * Injects a live URL validator override for unit testing.
 * @param {Function|null} fn
 */
export const setLiveUrlValidatorOverride = (fn = null) => {
  liveUrlValidatorOverride = fn;
};

/**
 * Verifies that a candidate URL is alive and returns HTTP 200.
 * Rejects 404s, 500s, domain errors, and dead pages.
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export const verifyLiveUrlStatus = async (url) => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

  if (liveUrlValidatorOverride) {
    return liveUrlValidatorOverride(trimmed);
  }
  if (process.env.NODE_ENV === 'test' && !globalThis.fetch?._isMockFunction && !globalThis.fetch?.mock) {
    return trimmed;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(trimmed, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status >= 200 && res.status < 300) {
      // Catch soft 404 pages (some stores return 200 with "/404" or "/not-found" in the redirected URL)
      const finalUrl = res.url || trimmed;
      if (finalUrl.includes('/404') || finalUrl.includes('/not-found') || finalUrl.includes('/error')) {
        return null;
      }
      return finalUrl;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Verifies that a candidate product image URL is alive, returns HTTP 200, and is not an error page.
 *
 * @param {string} imgUrl
 * @returns {Promise<string|null>}
 */
export const verifyLiveImageUrl = async (imgUrl) => {
  if (!imgUrl || typeof imgUrl !== 'string') return null;
  const trimmed = imgUrl.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

  if (liveUrlValidatorOverride) {
    return liveUrlValidatorOverride(trimmed);
  }
  if (process.env.NODE_ENV === 'test' && !globalThis.fetch?._isMockFunction && !globalThis.fetch?.mock) {
    return trimmed;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(trimmed, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (res.status >= 200 && res.status < 300) {
      const contentType = res.headers.get('content-type') || '';
      // Reject if server explicitly returned an HTML page instead of an image
      if (contentType.includes('text/html')) {
        return null;
      }
      return trimmed;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
  { season = 'all', genderPresentation = 'unisex', locale = 'en', anchorGarment = null } = {}
) => {
  const normQuery = String(query || '').toLowerCase().trim();
  const normSeason = String(season || 'all').toLowerCase().trim();
  const normGender = String(genderPresentation || 'unisex').toLowerCase().trim();
  const normLocale = String(locale || 'en').toLowerCase().trim();
  const anchorTag = anchorGarment
    ? `:${anchorGarment.category || ''}:${anchorGarment.subcategory || ''}:${anchorGarment.colorFamily || ''}`.toLowerCase()
    : '';
  const queryHash = crypto.createHash('sha256').update(`${normQuery}${anchorTag}`).digest('hex').slice(0, 16);

  return `ai:product-search:${normSeason}:${normGender}:${normLocale}:${queryHash}`;
};

/**
 * Checks whether a product search candidate duplicates the anchor garment that the user already owns.
 * Prevents suggesting buying another pullover/sweater if the user uploaded a pullover photo.
 *
 * @param {Object} cand
 * @param {Object|null} anchorGarment
 * @returns {boolean}
 */
export const isDuplicateAnchorCandidate = (cand, anchorGarment) => {
  if (!cand || !anchorGarment) return false;
  const sub = String(anchorGarment.subcategory || '').toLowerCase();
  const cat = String(anchorGarment.category || '').toLowerCase();
  const title = String(cand.title || '').toLowerCase();
  const itemType = String(cand.plannedItemType || cand.itemType || '').toLowerCase();
  const candidateSlot = String(cand.slot || cand.plannedSlot || '').toLowerCase();
  const text = `${title} ${itemType}`;

  // 1. Anchor is knitwear / sweater / pullover / quarter-zip / hoodie / cardigan
  const anchorIsSweaterOrKnit =
    sub.includes('sweater') ||
    sub.includes('pullover') ||
    sub.includes('knit') ||
    sub.includes('quarter_zip') ||
    sub.includes('hoodie') ||
    sub.includes('cardigan') ||
    sub.includes('sweatshirt') ||
    ((cat === 'outerwear' || cat === 'top') && /سويتر|بلوفر|كنزة|سحاب ربع/i.test(sub));

  if (anchorIsSweaterOrKnit) {
    const isSweaterCandidate =
      /سويتر|بلوفر|كنزة|سحاب ربع|هودي|كارديجان|sweater|pullover|quarter[-_ ]?zip|cardigan|sweatshirt|hoodie/i.test(text);
    if (isSweaterCandidate && (candidateSlot === 'top' || candidateSlot === 'outerwear')) {
      return true;
    }
  }

  // 2. Anchor is jacket / blazer / coat
  const anchorIsJacket =
    sub.includes('jacket') ||
    sub.includes('blazer') ||
    sub.includes('coat') ||
    /جاكيت|بليزر|معطف/i.test(sub);

  if (anchorIsJacket) {
    const isJacketCandidate =
      /جاكيت|بليزر|معطف|سترة|jacket|blazer|coat/i.test(text);
    if (isJacketCandidate && (candidateSlot === 'top' || candidateSlot === 'outerwear')) {
      return true;
    }
  }

  // 3. Anchor is pants / trousers / jeans / chinos
  const anchorIsBottom =
    cat === 'bottom' ||
    sub.includes('pant') ||
    sub.includes('trouser') ||
    sub.includes('jean') ||
    sub.includes('chino') ||
    /بنطال|سروال|جينز|تشينو/i.test(sub);

  if (anchorIsBottom && candidateSlot === 'bottom') {
    const isChino = /chino|تشينو/i.test(sub);
    const isJeans = /jean|جينز/i.test(sub);
    if ((isChino && /chino|تشينو/i.test(text)) || (isJeans && /jean|جينز/i.test(text))) {
      return true;
    }
  }

  return false;
};

/**
 * Saves resolved product suggestions into 24-hour Redis / in-memory cache.
 *
 * @param {string} cacheKey
 * @param {Array<Object>} suggestions
 */
export const cacheSuggestions = async (cacheKey, suggestions) => {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return;
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
};

/**
 * Executes decoupled 3-tier product search:
 * Tier 1: Gemini Planner (generates search queries, NO URLs touched)
 * Tier 2: Shopping Search API (fetches candidate products with Egypt settings)
 * Tier 3: Validation (HTTP 200, redirects, og:image, anti-mismatch)
 * Tier 4: Gemini Ranker (ranks candidates by ID and generates styling commentary)
 *
 * @param {Object} params
 * @returns {Promise<Array<Object>>}
 */
export const searchWithShoppingProvider = async ({
  gapDescription,
  gapItems = [],
  occasion = 'formal',
  formality = 'formal',
  season = 'all',
  genderPresentation = 'unisex',
  locale = 'en',
  budget,
  isShoppingRequest = false,
  shoppingProviderOverride = null,
  anchorGarment = null,
} = {}) => {
  const query = String(gapDescription || '').trim();
  if (!query) return [];

  const shoppingProvider = shoppingProviderOverride || getShoppingProvider();

  // Tier 1: Gemini Planner
  const isArabic = locale === 'ar';

  let anchorClause = '';
  let anchorPlannerUserText = '';
  if (anchorGarment) {
    const anchorDesc = [
      anchorGarment.colorFamily,
      anchorGarment.subcategory || anchorGarment.category,
      anchorGarment.material,
    ]
      .filter(Boolean)
      .join(' ');

    anchorClause = `
CLIENT ANCHOR PIECE (ALREADY OWNED BY CLIENT):
- The client ALREADY OWNS and is wearing this piece: "${anchorDesc}" (Category: ${anchorGarment.category}, Subcategory: ${anchorGarment.subcategory || 'n/a'}).
- ABSOLUTE PROHIBITION: NEVER search for, recommend, or plan queries for another garment of the same type/category as this anchor piece! Do NOT plan queries for sweaters, pullovers, or knitwear if the anchor is a sweater/pullover.
- YOUR GOAL: Plan items to COMPLEMENT and COMPLETE an outfit built AROUND this anchor piece:
  * If the anchor is a top or outerwear (e.g. sweater/pullover/jacket):
    - Top slot MUST be an inner layering piece to wear UNDER it (e.g. "قميص كلاسيكي أبيض رجالي" or "قميص أكسفورد سادة رجالي"). NEVER another sweater, jacket, or pullover!
    - Bottom slot: coordinating trousers/chinos/pants (e.g. "بنطال تشينو كحلي رجالي" or "بنطلون قماش رمادي رجالي").
    - Shoes slot: coordinating footwear (e.g. "حذاء لوفر جلد بني رجالي" or "حذاء رسمي جلد أسود").
  * If the anchor is a bottom: plan coordinating tops, layering outerwear, and shoes.
  * If the anchor is a dress: plan coordinating outerwear, shoes, and accessories.`;

    anchorPlannerUserText = `\nAnchor Garment Owned: ${anchorDesc} (DO NOT RECOMMEND DUPLICATE PIECES OF THIS TYPE)`;
  }

  const plannerSystemPrompt = `You are the Murafiq Personal Shopping Planner.
Your role is to plan specific, focused shopping search queries to find real, purchasable clothing and footwear available in the Egyptian market (Cairo, Alexandria, online fashion stores in Egypt).
Analyze the client request, missing wardrobe slots, anchor piece, occasion, and Egyptian market.
DO NOT output URLs, images, or links. Only generate targeted search queries (searchQuery) in ${isArabic ? 'Arabic' : 'English'} optimized for shopping search engines in Egypt (e.g. "قميص رسمي أبيض رجالي", "بنطال تشينو كحلي رجالي", "حذاء لوفر بني جلد").
${
  isShoppingRequest
    ? 'The user requested complete outfits. Plan queries for 2 COMPLETE coordinated outfits (each having one top, one bottom, one shoes; total 6 items). Set outfitIndex (1 or 2) and localized outfitTitle.'
    : 'Plan queries for 2 to 3 distinct options or missing items to complete the look.'
}${anchorClause}`;

  const budgetClause = budget ? ` Target Budget: ~${budget} EGP.` : '';
  const gapContext =
    Array.isArray(gapItems) && gapItems.length > 0
      ? `\nMissing Slots: ${gapItems.map((g) => `${g.slot}: ${g.description || g.slot}`).join(', ')}`
      : '';

  const plannerUserParts = `Plan shopping queries for:
Target Request: ${query}${gapContext}${anchorPlannerUserText}
Occasion: ${occasion}
Formality: ${formality}
Season: ${season}
Gender Presentation: ${genderPresentation}${budgetClause}
Language: ${isArabic ? 'Arabic (أجب باللغة العربية)' : 'English'}`;

  let plannedQueries = [];
  try {
    const planResult = await llmProvider.complete({
      task: 'reasoning',
      systemPrompt: plannerSystemPrompt,
      userParts: plannerUserParts,
      responseSchema: SEARCH_PLANNER_SCHEMA,
      temperature: 0.2,
      timeoutMs: 15_000,
    });
    plannedQueries = Array.isArray(planResult?.data?.queries) ? planResult.data.queries : [];
  } catch (planErr) {
    logger.warn('[ProductSearch] Planner LLM failed, using fallback query planning:', planErr.message);
  }

  // Fallback queries if planner returned empty
  if (plannedQueries.length === 0) {
    if (isShoppingRequest) {
      if (anchorGarment && (anchorGarment.category === 'top' || anchorGarment.category === 'outerwear')) {
        plannedQueries = [
          { slot: 'top', itemType: isArabic ? 'قميص أكسفورد' : 'oxford shirt', searchQuery: isArabic ? 'قميص أكسفورد كلاسيكي رجالي' : 'mens oxford button down shirt', outfitIndex: 1, outfitTitle: isArabic ? 'إطلالة كلاسيكية ذكية' : 'Smart Classic Look' },
          { slot: 'bottom', itemType: isArabic ? 'بنطال تشينو' : 'chino pants', searchQuery: isArabic ? 'بنطال تشينو كحلي رجالي' : 'mens navy chino pants', outfitIndex: 1, outfitTitle: isArabic ? 'إطلالة كلاسيكية ذكية' : 'Smart Classic Look' },
          { slot: 'shoes', itemType: isArabic ? 'حذاء لوفر' : 'loafers', searchQuery: isArabic ? 'حذاء لوفر جلد بني رجالي' : 'mens brown leather loafers', outfitIndex: 1, outfitTitle: isArabic ? 'إطلالة كلاسيكية ذكية' : 'Smart Classic Look' },
          { slot: 'top', itemType: isArabic ? 'قميص كلاسيكي' : 'classic shirt', searchQuery: isArabic ? 'قميص كلاسيك أبيض قطن رجالي' : 'mens classic white dress shirt', outfitIndex: 2, outfitTitle: isArabic ? 'إطلالة يومية أنيقة' : 'Elevated Daily Look' },
          { slot: 'bottom', itemType: isArabic ? 'بنطلون قماش' : 'tailored trousers', searchQuery: isArabic ? 'بنطلون قماش رمادي رجالي' : 'mens charcoal dress trousers', outfitIndex: 2, outfitTitle: isArabic ? 'إطلالة يومية أنيقة' : 'Elevated Daily Look' },
          { slot: 'shoes', itemType: isArabic ? 'حذاء ديربي' : 'derby shoes', searchQuery: isArabic ? 'حذاء كلاسيك أسود جلد رجالي' : 'mens black dress shoes', outfitIndex: 2, outfitTitle: isArabic ? 'إطلالة يومية أنيقة' : 'Elevated Daily Look' },
        ];
      } else {
        plannedQueries = [
          { slot: 'top', itemType: isArabic ? 'قميص' : 'shirt', searchQuery: isArabic ? `${query} قميص رجالي` : `${query} mens shirt`, outfitIndex: 1, outfitTitle: isArabic ? 'الإطلالة الأولى' : 'Look 1' },
          { slot: 'bottom', itemType: isArabic ? 'بنطال' : 'pants', searchQuery: isArabic ? `${query} بنطال رجالي` : `${query} mens pants`, outfitIndex: 1, outfitTitle: isArabic ? 'الإطلالة الأولى' : 'Look 1' },
          { slot: 'shoes', itemType: isArabic ? 'حذاء' : 'shoes', searchQuery: isArabic ? `${query} حذاء رجالي` : `${query} mens shoes`, outfitIndex: 1, outfitTitle: isArabic ? 'الإطلالة الأولى' : 'Look 1' },
        ];
      }
    } else if (Array.isArray(gapItems) && gapItems.length > 0) {
      plannedQueries = gapItems.map((g, idx) => ({ // eslint-disable-line no-unused-vars
        slot: g.slot || 'top',
        itemType: g.description || g.slot,
        searchQuery: `${g.description || g.slot} ${query}`.trim(),
        outfitIndex: 1,
        outfitTitle: null,
      }));
    } else {
      const normQ = query.toLowerCase();
      let inferredSlot = 'top';
      if (/بنطال|سروال|جينز|تشينو|trousers|pants|chino|jeans/i.test(normQ)) inferredSlot = 'bottom';
      else if (/حذاء|لوفر|أكسفورد|سنيكرز|shoes|loafer|sneaker|oxford|boots/i.test(normQ)) inferredSlot = 'shoes';
      else if (/جاكيت|بليزر|معطف|سترة|blazer|jacket|coat/i.test(normQ)) inferredSlot = 'outerwear';
      else if (/فستان|dress/i.test(normQ)) inferredSlot = 'dress';

      plannedQueries = [{
        slot: inferredSlot,
        itemType: query,
        searchQuery: query,
        outfitIndex: 1,
        outfitTitle: null,
      }];
    }
  }

  // Tier 2: Shopping Search API across planned queries
  const rawCandidatePool = [];
  const seenCandidateKeys = new Set();

  for (const plan of plannedQueries.slice(0, 6)) {
    try {
      const candidates = await shoppingProvider.searchProducts({
        query: plan.searchQuery,
        gl: 'eg',
        hl: isArabic ? 'ar' : 'en',
        limit: 3,
      });

      if (Array.isArray(candidates)) {
        for (const cand of candidates) {
          const candidateSlot = cand.slot || plan.slot;
          const dedupKey = `${cand.id || cand.productUrl}_${candidateSlot}`;
          if (seenCandidateKeys.has(dedupKey)) continue;
          seenCandidateKeys.add(dedupKey);

          rawCandidatePool.push({
            ...cand,
            slot: candidateSlot,
            plannedSlot: candidateSlot,
            plannedItemType: plan.itemType,
            plannedOutfitIndex: plan.outfitIndex,
            plannedOutfitTitle: plan.outfitTitle,
            targetColor: plan.targetColor,
          });
        }
      }
    } catch (candErr) {
      logger.warn(`[ProductSearch] Shopping search failed for "${plan.searchQuery}":`, candErr.message);
    }
  }

  if (rawCandidatePool.length === 0) {
    return [];
  }

  // Tier 3: Validation Filter (HTTP 200, redirects, og:image, anti-mismatch)
  const validatedCandidates = [];
  for (const cand of rawCandidatePool) {
    try {
      if (cand.source === 'mock') {
        // Mock candidates are pre-validated offline fixtures; check syntax and anti-fabrication rules without live network calls
        const verifiedSyntax = verifyDirectProductUrl(cand.productUrl, cand);
        if (!verifiedSyntax) continue;
        const verifiedImageUrl = verifyProductImageUrl(cand.imageUrl, cand, verifiedSyntax);
        if (!verifiedImageUrl) continue;
        if (isDuplicateAnchorCandidate(cand, anchorGarment)) continue;
        validatedCandidates.push({
          ...cand,
          productUrl: verifiedSyntax,
          imageUrl: verifiedImageUrl,
        });
        continue;
      }

      const unredirectedUrl = await resolveRedirectUrl(cand.productUrl);
      const verifiedSyntax = verifyDirectProductUrl(unredirectedUrl, cand);
      if (!verifiedSyntax) continue;

      const verifiedLiveUrl = await verifyLiveUrlStatus(verifiedSyntax);
      if (!verifiedLiveUrl) continue;

      let verifiedImageUrl = verifyProductImageUrl(cand.imageUrl, cand, verifiedLiveUrl);
      if (!verifiedImageUrl && verifiedLiveUrl) {
        const ogImage = await extractOgImage(verifiedLiveUrl);
        if (ogImage) {
          verifiedImageUrl = verifyProductImageUrl(ogImage, cand, verifiedLiveUrl);
        }
      }

      if (verifiedImageUrl) {
        verifiedImageUrl = await verifyLiveImageUrl(verifiedImageUrl);
      }

      // STRICT ZERO-NULL: Candidate must have both verified live URL and image
      if (!verifiedImageUrl) {
        continue;
      }

      // STRICT ZERO-DUPLICATE: Reject candidate if it duplicates the user's anchor garment
      if (isDuplicateAnchorCandidate(cand, anchorGarment)) {
        continue;
      }

      validatedCandidates.push({
        ...cand,
        productUrl: verifiedLiveUrl,
        imageUrl: verifiedImageUrl,
      });
    } catch (valErr) {
      logger.warn('[ProductSearch] Candidate validation error:', valErr.message);
    }
  }

  if (validatedCandidates.length === 0) {
    return [];
  }

  // Tier 4: Gemini Stylist Ranker & Copywriter
  // Prepare concise candidate pool summary (NO URLs passed to Gemini)
  const candidatePoolSummary = validatedCandidates.map((c) => ({
    candidateId: c.id,
    slot: c.slot || c.plannedSlot,
    title: c.title,
    retailer: c.retailer,
    price: c.price,
    outfitIndex: c.plannedOutfitIndex,
  }));

  const rankerOutfitClause = isShoppingRequest
    ? 'The user requested complete outfits. Select exactly 6 pieces to form 2 COMPLETE coordinated outfits (each outfit having 1 top, 1 bottom, 1 shoes; total 6 pieces). Set outfitIndex (1 or 2) and localized outfitTitle for each item.'
    : 'Select 2 to 3 distinct acquisition suggestions to close wardrobe gaps.';

  const rankerAnchorClause = anchorGarment
    ? `\n6. CLIENT ANCHOR PIECE: The client already owns and wears: ${[anchorGarment.colorFamily, anchorGarment.subcategory || anchorGarment.category].filter(Boolean).join(' ')}. NEVER select any pieces that duplicate this anchor garment category or type. For top garments, only select inner layering pieces (e.g. shirts) to wear under it. In each description, explain how the item coordinates with and complements this anchor piece.`
    : '';

  const rankerSystemPrompt = `You are the Murafiq Senior Fashion Stylist.
Below is a pool of real, verified commercial fashion pieces available for purchase in Egypt.
Your task is to select the most stylish items that best coordinate with the client's request and write tailored, personalized styling descriptions for each piece.
CRITICAL RULES:
1. Select pieces by candidateId from the provided candidate list.
2. Formulate the response in ${isArabic ? 'Arabic (العربية)' : 'English'}.
3. For each selected item, write an inspiring styling description (description) explaining why this piece complements the look or anchor garment.
4. DO NOT generate or modify URLs.
5. ${rankerOutfitClause}${rankerAnchorClause}`;

  const rankerUserParts = `Client Request: ${query}
${anchorGarment ? `Anchor Garment Owned: ${[anchorGarment.colorFamily, anchorGarment.subcategory || anchorGarment.category].filter(Boolean).join(' ')}\n` : ''}Occasion: ${occasion}
Formality: ${formality}
Season: ${season}
Candidate Items Pool:
${JSON.stringify(candidatePoolSummary, null, 2)}`;

  let selections = [];
  try {
    const rankResult = await llmProvider.complete({
      task: 'reasoning',
      systemPrompt: rankerSystemPrompt,
      userParts: rankerUserParts,
      responseSchema: SEARCH_RANKER_SCHEMA,
      temperature: 0.2,
      timeoutMs: 15_000,
    });
    selections = Array.isArray(rankResult?.data?.selectedItems) ? rankResult.data.selectedItems : [];
  } catch (rankErr) {
    logger.warn('[ProductSearch] Ranker LLM failed, using direct candidate mapping:', rankErr.message);
  }

  // Candidate lookup map
  const candidateMap = new Map();
  validatedCandidates.forEach((c) => {
    if (!candidateMap.has(c.id)) {
      candidateMap.set(c.id, c);
    }
  });

  let finalSuggestions = [];

  if (selections.length > 0) {
    finalSuggestions = selections
      .map((sel) => {
        const cand = candidateMap.get(sel.candidateId);
        if (!cand || !cand.productUrl || !cand.imageUrl) return null;
        if (isDuplicateAnchorCandidate(cand, anchorGarment)) return null;

        return {
          slot: sel.slot || cand.slot || cand.plannedSlot || 'accessory',
          itemType: sel.itemType || cand.plannedItemType || cand.title,
          title: sel.customTitle || cand.title,
          description: sel.description || '',
          estimatedPriceEgp: cand.price,
          retailer: cand.retailer,
          sourceUrl: cand.productUrl,
          sourceTitle: cand.retailer,
          imageUrl: cand.imageUrl,
          citations: [{ title: cand.retailer, url: cand.productUrl }],
          isGrounded: true,
          outfitIndex: typeof sel.outfitIndex === 'number' ? sel.outfitIndex : cand.plannedOutfitIndex || null,
          outfitTitle: sel.outfitTitle || cand.plannedOutfitTitle || null,
          cacheHit: false,
        };
      })
      .filter(Boolean);
  }

  // Fallback mapping if ranker produced no matches
  if (finalSuggestions.length === 0) {
    const maxItems = isShoppingRequest ? 6 : 2;
    finalSuggestions = validatedCandidates
      .filter((cand) => Boolean(cand.productUrl && cand.imageUrl) && !isDuplicateAnchorCandidate(cand, anchorGarment))
      .slice(0, maxItems)
      .map((cand) => ({
        slot: cand.plannedSlot || 'accessory',
        itemType: cand.plannedItemType || cand.title,
        title: cand.title,
        description: isArabic
          ? `قطعة أنيقة ومتناسقة من ${cand.retailer} لتكملة إطلالتك.`
          : `Stylish coordinating piece from ${cand.retailer} to complete your look.`,
        estimatedPriceEgp: cand.price,
        retailer: cand.retailer,
        sourceUrl: cand.productUrl,
        sourceTitle: cand.retailer,
        imageUrl: cand.imageUrl,
        citations: [{ title: cand.retailer, url: cand.productUrl }],
        isGrounded: true,
        outfitIndex: cand.plannedOutfitIndex || null,
        outfitTitle: cand.plannedOutfitTitle || null,
        cacheHit: false,
      }));
  }

  return finalSuggestions.filter((s) => Boolean(s.sourceUrl && s.imageUrl));
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
 * @param {boolean} [params.isShoppingRequest=false]
 * @param {boolean} [params.useShoppingProvider=false]
 * @param {boolean} [params.forceGroundedSearch=false]
 * @param {Object} [params.shoppingProviderOverride=null]
 * @param {Object|null} [params.anchorGarment=null]
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
  isShoppingRequest = false,
  _useShoppingProvider = false,
  _forceGroundedSearch = false,
  shoppingProviderOverride = null,
  anchorGarment = null,
} = {}) => {
  const query = String(gapDescription || '').trim();
  if (!query) {
    return [];
  }

  const cacheKey = computeCacheKey(query, { season, genderPresentation, locale, anchorGarment });

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

  // 2. Execute Shopping Provider Pipeline (Serper / SerpApi / Mock)
  try {
    const shoppingSuggestions = await searchWithShoppingProvider({
      gapDescription: query,
      gapItems,
      occasion,
      formality,
      season,
      genderPresentation,
      locale,
      budget,
      isShoppingRequest,
      shoppingProviderOverride,
      anchorGarment,
    });

    if (shoppingSuggestions && shoppingSuggestions.length > 0) {
      const zeroNullSuggestions = shoppingSuggestions.filter(
        (s) => Boolean(s.sourceUrl && s.imageUrl)
      );
      if (zeroNullSuggestions.length > 0) {
        await cacheSuggestions(cacheKey, zeroNullSuggestions);
        return zeroNullSuggestions;
      }
    }
  } catch (shopErr) {
    logger.warn('[ProductSearch] Shopping search failed:', shopErr.message);
  }

  return [];
};

export default {
  CACHE_TTL_SECONDS,
  SEARCH_PLANNER_SCHEMA,
  SEARCH_RANKER_SCHEMA,
  STOCK_AND_PLACEHOLDER_DOMAINS,
  getKnownRetailerInfo,
  verifyDirectProductUrl,
  verifyProductImageUrl,
  verifyLiveUrlStatus,
  verifyLiveImageUrl,
  setLiveUrlValidatorOverride,
  resolveRedirectUrl,
  extractOgImage,
  setProductSearchRedisOverride,
  clearInMemoryProductCache,
  computeCacheKey,
  cacheSuggestions,
  isDuplicateAnchorCandidate,
  searchWithShoppingProvider,
  searchExternalProducts,
};
