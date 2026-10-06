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
          outfitIndex: { type: 'NUMBER' },
          outfitTitle: { type: 'STRING' },
        },
        required: ['title', 'itemType', 'slot', 'description'],
      },
    },
    rationale: { type: 'STRING' },
  },
  required: ['suggestions'],
});

export const KNOWN_RETAILERS = [
  {
    match: /zara|زارا/i,
    title: 'Zara Egypt',
    domain: 'zara.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=zara.com&sz=128',
    buildSearchUrl: (q) => `https://www.zara.com/eg/ar/search?searchTerm=${encodeURIComponent(q)}`,
  },
  {
    match: /massimo\s*dutti|ماسيمو\s*دوتي/i,
    title: 'Massimo Dutti Egypt',
    domain: 'massimodutti.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=massimodutti.com&sz=128',
    buildSearchUrl: (q) => `https://www.massimodutti.com/eg/en/search?searchTerm=${encodeURIComponent(q)}`,
  },
  {
    match: /h&m|h\s*and\s*m|إتش\s*آند\s*إم|اتش\s*اند\s*ام|اتش\s*ان\s*ام/i,
    title: 'H&M Egypt',
    domain: 'hm.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=hm.com&sz=128',
    buildSearchUrl: (q) => `https://eg.hm.com/ar/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /amazon|أمازون|امازون/i,
    title: 'Amazon Egypt',
    domain: 'amazon.eg',
    logoUrl: 'https://www.google.com/s2/favicons?domain=amazon.eg&sz=128',
    buildSearchUrl: (q) => `https://www.amazon.eg/s?k=${encodeURIComponent(q)}`,
  },
  {
    match: /jumia|جوميا/i,
    title: 'Jumia Egypt',
    domain: 'jumia.com.eg',
    logoUrl: 'https://www.google.com/s2/favicons?domain=jumia.com.eg&sz=128',
    buildSearchUrl: (q) => `https://www.jumia.com.eg/catalog/?q=${encodeURIComponent(q)}`,
  },
  {
    match: /noon|نون/i,
    title: 'Noon Egypt',
    domain: 'noon.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=noon.com&sz=128',
    buildSearchUrl: (q) => `https://www.noon.com/egypt-ar/search/?q=${encodeURIComponent(q)}`,
  },
  {
    match: /asos|أسوس|اسوس/i,
    title: 'ASOS',
    domain: 'asos.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=asos.com&sz=128',
    buildSearchUrl: (q) => `https://www.asos.com/search/?q=${encodeURIComponent(q)}`,
  },
  {
    match: /namshi|نمشي/i,
    title: 'Namshi',
    domain: 'namshi.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=namshi.com&sz=128',
    buildSearchUrl: (q) => `https://www.namshi.com/egypt-ar/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /mango|مانجو|مانغو/i,
    title: 'Mango Egypt',
    domain: 'mango.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=mango.com&sz=128',
    buildSearchUrl: (q) => `https://shop.mango.com/eg-ar/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /defacto|ديفاكتو|دي\s*فاكتو/i,
    title: 'DeFacto Egypt',
    domain: 'defacto.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=defacto.com&sz=128',
    buildSearchUrl: (q) => `https://www.defacto.com/ar-eg/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /lc\s*waikiki|إل\s*سي\s*وايكيكي|ال\s*سي\s*وايكيكي|وايكيكي/i,
    title: 'LC Waikiki',
    domain: 'lcwaikiki.eg',
    logoUrl: 'https://www.google.com/s2/favicons?domain=lcwaikiki.eg&sz=128',
    buildSearchUrl: (q) => `https://www.lcwaikiki.eg/%D8%A8%D8%AD%D8%AB?q=${encodeURIComponent(q)}`,
  },
  {
    match: /pull\s*(&|and)?\s*bear|بول\s*آند\s*بير|بول\s*اند\s*بير|بول\s*ان\s*بير/i,
    title: 'Pull&Bear',
    domain: 'pullandbear.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=pullandbear.com&sz=128',
    buildSearchUrl: (q) => `https://www.pullandbear.com/eg/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /bershka|بيرشكا|برشكا/i,
    title: 'Bershka',
    domain: 'bershka.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=bershka.com&sz=128',
    buildSearchUrl: (q) => `https://www.bershka.com/eg/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /stradivarius|ستراديفاريوس|استراديفاريوس/i,
    title: 'Stradivarius',
    domain: 'stradivarius.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=stradivarius.com&sz=128',
    buildSearchUrl: (q) => `https://www.stradivarius.com/eg/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /town\s*team|تاون\s*تيم/i,
    title: 'Town Team',
    domain: 'townteam.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=townteam.com&sz=128',
    buildSearchUrl: (q) => `https://townteam.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /tie\s*house|تاي\s*هاوس/i,
    title: 'Tie House',
    domain: 'tie-house.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=tie-house.com&sz=128',
    buildSearchUrl: (q) => `https://tie-house.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /lotfy|لطفي/i,
    title: 'Lotfy',
    domain: 'lotfy.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=lotfy.com&sz=128',
    buildSearchUrl: (q) => `https://lotfy.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /dejavu|ديجافو|دي\s*جافو/i,
    title: 'Dejavu',
    domain: 'dejavu.shoes',
    logoUrl: 'https://www.google.com/s2/favicons?domain=dejavu.shoes&sz=128',
    buildSearchUrl: (q) => `https://dejavu.shoes/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /concrete|كونكريت/i,
    title: 'Concrete Egypt',
    domain: 'concrete.me',
    logoUrl: 'https://www.google.com/s2/favicons?domain=concrete.me&sz=128',
    buildSearchUrl: (q) => `https://concrete.me/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /mobaco|موباكو/i,
    title: 'Mobaco Cottons',
    domain: 'mobaco.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=mobaco.com&sz=128',
    buildSearchUrl: (q) => `https://mobaco.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /dalydress|دالي\s*دريس/i,
    title: 'Dalydress',
    domain: 'dalydress.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=dalydress.com&sz=128',
    buildSearchUrl: (q) => `https://dalydress.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /jlood|جلود/i,
    title: 'Jlood',
    domain: 'jlood.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=jlood.com&sz=128',
    buildSearchUrl: (q) => `https://jlood.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    match: /antikka|أنتيكة|انتيكة/i,
    title: 'Antikka',
    domain: 'antikkaeg.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=antikkaeg.com&sz=128',
    buildSearchUrl: (q) => `https://antikkaeg.com/search?q=${encodeURIComponent(q)}`,
  },
];

export const getKnownRetailerInfo = (retailerName = '') => {
  const str = String(retailerName || '').trim();
  if (!str) return null;
  const found = KNOWN_RETAILERS.find((r) => r.match.test(str));
  return found
    ? {
        title: found.title,
        domain: found.domain,
        logoUrl: found.logoUrl,
        buildSearchUrl: found.buildSearchUrl,
      }
    : null;
};

export const cleanSearchQuery = (title = '', itemType = '') => {
  const raw = `${title || ''} ${itemType || ''}`
    // Remove punctuation, hyphens, parenthesis, slashes, numbers, symbols
    .replace(/[-–—/\\(),.:_#0-9]/g, ' ')
    // Remove filler adjectives and marketing buzzwords in Arabic & English
    .replace(/\b(فاخر|مميز|أنيق|عصري|كلاسيك|كلاسيكي|طبيعي|جداً|مريح|رسمي|للرجال|للنساء|رجالي|حريمي|موديل|تشكيلة)\b/g, ' ')
    .replace(/\b(luxury|classic|formal|comfortable|elegant|men|women|stylish|collection|genuine)\b/gi, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  const words = raw.split(' ').filter(Boolean);
  // Pick up to 4 most descriptive keywords (e.g. "حذاء أكسفورد أسود" or "بنطلون تشينو رمادي")
  if (words.length <= 4) return raw;
  return words.slice(0, 4).join(' ');
};

export const buildRetailerSearchUrl = (retailerName = '', query = '') => {
  const cleanQ = cleanSearchQuery(query);
  const known = getKnownRetailerInfo(retailerName);
  if (known?.buildSearchUrl) {
    return known.buildSearchUrl(cleanQ);
  }
  const cleanRetailer = String(retailerName || '').trim();
  const fullSearch = [cleanRetailer, cleanQ, 'مصر'].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(fullSearch)}`;
};

export const buildRetailerLogoUrl = (retailerName = '') => {
  const known = getKnownRetailerInfo(retailerName);
  if (known?.logoUrl) {
    return known.logoUrl;
  }
  const clean = String(retailerName || '').trim();
  if (!clean || !clean.includes('.') || /\s/.test(clean)) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=128`;
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

// Recognized authentic retailer CDN image domains permitted even when deep product sourceUrl falls back to store search
export const AUTHENTIC_RETAILER_IMAGE_DOMAINS = Object.freeze([
  'static.zara.net',
  'mncdn.com',
  'img-lcwaikiki.mncdn.com',
  'jumia.is',
  'eg.jumia.is',
  'nooncdn.com',
  'f.nooncdn.com',
  'media-amazon.com',
  'm.media-amazon.com',
  'hm.com',
  'lp2.hm.com',
  'image.hm.com',
  'static.massimodutti.net',
  'defacto.com',
  'dfcdn.defacto.com.tr',
  'mngbcn.com',
  'st.mngbcn.com',
  'pullandbear.net',
  'static.pullandbear.net',
  'bershka.net',
  'static.bershka.net',
  'stradivarius.net',
  'static.stradivarius.net',
  'shopify.com',
  'cdn.shopify.com',
  'townteam.com',
  'tie-house.com',
  'lotfy.com',
  'dejavu.shoes',
  'concrete.me',
  'mobaco.com',
  'dalydress.com',
  'jlood.com',
  'antikkaeg.com',
  'google.com',
  'www.google.com',
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

  // 2b. Allow authentic Google Grounding redirect URLs directly
  if (
    hostname === 'vertexaisearch.cloud.google.com' &&
    parsed.pathname.toLowerCase().startsWith('/grounding-api-redirect/')
  ) {
    return parsed.href;
  }

  // 2c. Reject dead/redirecting domains that lead to Akamai Access Denied portals (e.g. lcwaikiki.com -> lcw.com)
  if (
    hostname === 'lcwaikiki.com' ||
    hostname.endsWith('.lcwaikiki.com') ||
    hostname === 'lcw.com' ||
    hostname.endsWith('.lcw.com')
  ) {
    return null;
  }

  const pathname = parsed.pathname.trim().toLowerCase();

  // Reject image or asset URLs mistakenly passed as sourceUrl
  if (/\.(jpg|jpeg|png|webp|gif|avif|svg)(\?.*)?$/i.test(pathname)) {
    return null;
  }

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

  // 6. Explicitly reject category codes like -c358017.html, /c/ paths, or Zara listing codes like -l706.html
  if (/-(c\d+|cat\d+|l\d+)\.html$/i.test(pathname) || /^\/c\/[a-z0-9-]+$/i.test(pathname)) {
    return null;
  }

  // 7. Require a concrete product-page indicator or a sufficiently deep product slug
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] || '';

  const hasProductIndicator =
    /\/(products?|p|dp|item|pd)\//i.test(pathname) ||
    /-(p\d+|c\d*p\d+|sku\d+|\d{5,})\.html$/i.test(pathname) ||
    /productpage\.\d+/i.test(pathname) ||
    /buy-[a-z0-9-]+/i.test(pathname) ||
    /\/\d{5,}(\.html)?$/i.test(pathname) ||
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

  // 3. Reject generic placeholder, icon, banner, logo, lookbook, campaign, editorial, and LLM-fabricated dummy images
  const fullImgTarget = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  const isRejectedPattern =
    /lookbook|campaign|editorial|placeholder|default[-_]?image|no[-_]?image|missing[-_]?image|banner|logo|avatar|icon|fallback|chatgpt|dummy|sample|1710000000|download_[a-f0-9-]{10,}|\.svg$/i.test(
      fullImgTarget
    );
  if (isRejectedPattern) {
    return null;
  }

  // 3b. Source URL correlation check:
  // If verifiedSourceUrl is absent or a Google Grounding redirect URL, only permit authentic fashion retailer CDN domains
  const hasDirectVerifiedSource = Boolean(
    verifiedSourceUrl &&
    typeof verifiedSourceUrl === 'string' &&
    !verifiedSourceUrl.includes('vertexaisearch.cloud.google.com')
  );

  if (!hasDirectVerifiedSource) {
    const isAuthenticFashionCdn = AUTHENTIC_RETAILER_IMAGE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
    if (!isAuthenticFashionCdn) {
      return null;
    }
  }

  // 4. Check for conflicting SKU if both image and sourceUrl have distinct product identifiers
  if (hasDirectVerifiedSource) {
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
  isShoppingRequest = false,
  anchor = null,
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

  const itemFields = `  * slot: garment category (top, bottom, shoes, outerwear, accessory, dress)
  * itemType: specific fashion garment type
  * title: exact descriptive title
  * retailer: retailer name in Egypt
  * estimatedPriceEgp: estimated price in EGP
  * sourceUrl: exact verified direct product page/purchase URL found in search results (e.g. https://www.zara.com/eg/en/wool-trousers-p12345.html). Return null if no exact direct product page is found. NEVER provide a retailer homepage, category page, or search page.
  * sourceTitle: store product title
  * imageUrl: exact verified product image URL found in search results, metadata, or retailer CDN (e.g. static.zara.net, img-lcwaikiki.mncdn.com, eg.jumia.is, f.nooncdn.com, m.media-amazon.com, static.massimodutti.net, shopify CDN). Return null only if no authentic product image can be located. NEVER invent an image URL, never use Unsplash/stock photography, and never use placeholder images.
  * description: detailed styling description.`;

  const anchorDesc = anchor
    ? [anchor.colorFamily, anchor.subcategory || anchor.category].filter(Boolean).join(' ')
    : null;

  const targetSlotsText = Array.isArray(gapItems) && gapItems.length > 0
    ? gapItems.map((g) => g.slot).join(', ')
    : 'bottom, shoes';

  const genderRule = `STRICT SINGLE-GENDER CONSISTENCY RULE:
- Both Outfit 1 and Outfit 2 MUST be designed for the SAME individual matching gender presentation: "${genderPresentation}".
- NEVER mix genders across the outfits (e.g. NEVER make Outfit 1 for men and Outfit 2 for women). Both outfits must be exclusively for the same user (${genderPresentation}).`;

  const imageRule = `MANDATORY PRODUCT PHOTO REQUIREMENT:
- For EVERY suggested piece, you MUST locate and provide the authentic product image URL (imageUrl) from the store's CDN or catalog.
- Prioritize pieces that have real product photography available so that cards do not have missing or null images.`;

  const suggestionRule = isShoppingRequest
    ? (anchor
        ? `ANCHOR-COMPLEMENTARY OUTFIT RULE:
- The user already owns this anchor piece: "${anchorDesc || 'anchor garment'}".
- You MUST find complementary pieces to complete the look WITH this anchor garment.
- STRICT EXCLUSION: NEVER recommend or suggest items of the same category or fashion type as the anchor (e.g. if the anchor is a sweater, pullover, or top, DO NOT suggest sweaters, pullovers, or tops to buy).
- Generate exactly 2 distinct coordinated looks that PAIR WITH the anchor garment.
- Each look should contain complementary items from: ${targetSlotsText}.
- Outfit 1 and Outfit 2 must represent DIFFERENT styling directions (e.g. formal vs smart-casual).
- ${genderRule}
- ${imageRule}
- Each item must specify:
${itemFields}
  * outfitIndex: outfit group number (1 or 2)
  * outfitTitle: localized outfit name describing the style direction (e.g. "الإطلالة الأولى (رسمية كلاسيكية)" or "Look 1 (Classic Formal)").
- Never duplicate products or suggest identical items under different names.`
        : `TWO-OUTFIT RULE (COMPLETE LOOK MODE):
- The user explicitly asked to shop for a COMPLETE outfit from the internet.
- Generate exactly 2 COMPLETE coordinated outfits. Each outfit MUST contain 3 items: one top, one bottom, and one pair of shoes.
- Total: 6 items. Outfit 1 and Outfit 2 must represent DIFFERENT styling directions (e.g. casual vs smart casual, streetwear vs classic, sporty vs elegant).
- ${genderRule}
- ${imageRule}
- Each item must specify:
${itemFields}
  * outfitIndex: outfit group number (1 or 2)
  * outfitTitle: localized outfit name describing the style direction (e.g. "الإطلالة الأولى (كاجوال يومي)" or "Look 1 (Casual Daily)").
- Never duplicate products or suggest identical items under different names.`)
    : `TWO-SUGGESTION RULE:
- Generate up to 2 distinct acquisition suggestions representing different aesthetic choices or price alternatives.
- ${genderRule}
- ${imageRule}
- Each suggestion must specify:
${itemFields}
- Never duplicate products or suggest identical items under different names.`;

  const systemPrompt = `You are the Murafiq Senior Fashion Personal Shopper and Acquisition Assistant.
Your duty is to recommend real, purchasable clothing and footwear pieces available for the Egyptian market (Cairo, Alexandria, online retail in Egypt) to close specific wardrobe gaps for clients.
Search across ANY legitimate fashion retailer, marketplace, or brand delivering in Egypt (including but not limited to Amazon Egypt, Jumia, Noon, ASOS, Zara, H&M, Mango, DeFacto, LC Waikiki, Massimo Dutti, Pull&Bear, Bershka, Stradivarius, Max, and Egyptian brands like Concrete, Town Team, Mobaco Cottons, Dalydress, Tie House, local boutiques, etc.). DO NOT restrict recommendations to only Zara or H&M; explore diverse online stores and find the exact piece the user needs wherever it is purchasable online.

STRICT RETAILER REQUIREMENT (MANDATORY):
- You MUST select and recommend items ONLY from legitimate, verified retailers operating in Egypt:
  * Major Online Stores: Jumia Egypt, Amazon Egypt, Noon Egypt
  * Global Fashion in Egypt: Zara, Massimo Dutti, H&M, DeFacto, LC Waikiki, Mango, Pull&Bear, Bershka, Stradivarius
  * Egyptian Brands: Town Team, Tie House, Lotfy, Concrete, Mobaco Cottons, Dalydress, Jlood, Antikka, Dejavu
- NEVER recommend or invent fictitious, unknown, or fabricated brands or boutiques (e.g. NEVER suggest invented names like "DeBacker's").

DIRECT PRODUCT PAGE URL REQUIREMENT:
- For the "sourceUrl" field, provide ONLY the direct product purchase page URL on the official retailer website where the user can buy that exact piece (e.g. "https://www.massimodutti.com/eg/en/..." or "https://www.zara.com/eg/en/...-p04404332.html" or "https://eg.hm.com/en/buy-...html").
- NEVER provide a search URL, listing page, or homepage in "sourceUrl".
- If you do not have the verified direct product page URL, leave "sourceUrl" as null (our system automatically generates the dedicated retailer store search link).

${suggestionRule}

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

  const maxSuggestions = isShoppingRequest ? 6 : 2;
  const rawSuggestions = Array.isArray(result?.data?.suggestions)
    ? result.data.suggestions.slice(0, maxSuggestions)
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

    const isDirectGrounded = Boolean(
      resolvedUrl && (
        primaryCitation?.url === resolvedUrl ||
        resolvedUrl.includes('vertexaisearch.cloud.google.com') ||
        (Array.isArray(citations) && citations.some((c) => c.url === resolvedUrl))
      )
    );

    // Verify candidate product image URL with strict anti-fabrication / anti-stock rules
    const resolvedImageUrl = verifyProductImageUrl(s.imageUrl, s, resolvedUrl);

    const itemCitations = citations.length > 0
      ? citations
      : (resolvedUrl ? [{ title: resolvedTitle || 'Retailer', url: resolvedUrl }] : []);

    // Always provide the store searchUrl on the retailer's official website as a dedicated search link
    const searchUrl = buildRetailerSearchUrl(s.retailer, s.title || s.itemType || '');

    return {
      slot: s.slot || 'accessory',
      itemType: s.itemType || s.title || 'Fashion Garment',
      title: s.title || 'Suggested Piece',
      description: s.description || '',
      estimatedPriceEgp: typeof s.estimatedPriceEgp === 'number' ? s.estimatedPriceEgp : null,
      retailer: s.retailer || knownRetailer?.title || resolvedTitle || 'Online Retailer',
      sourceUrl: resolvedUrl,
      sourceTitle: resolvedTitle,
      searchUrl,
      imageUrl: resolvedImageUrl,
      citations: itemCitations,
      isGrounded: Boolean(isGrounded && isDirectGrounded),
      outfitIndex: typeof s.outfitIndex === 'number' ? s.outfitIndex : null,
      outfitTitle: s.outfitTitle || null,
      cacheHit: false,
    };
  });

  // Defensive post-processing: If user provided an anchor garment, exclude any suggested
  // item that matches the anchor category or type (e.g. do not suggest sweaters if anchor is a sweater)
  const finalSuggestions = anchor
    ? suggestions.filter((item) => {
        const isAnchorTop =
          anchor.category === 'top' ||
          (anchor.category === 'outerwear' &&
            /sweater|pullover|knit|hoodie|cardigan|sweatshirt|quarter[_\s-]*zip/i.test(
              `${anchor.subcategory || ''} ${anchor.styleTags?.join(' ') || ''}`
            ));

        if (isAnchorTop && item.slot === 'top') {
          return false;
        }
        if (item.slot === anchor.category) {
          return false;
        }

        const text = `${item.title} ${item.itemType} ${item.description}`.toLowerCase();
        if (isAnchorTop && /كنزة|بلوفر|سترة صوفية|سويتر|sweater|pullover|knitwear|quarter[_\s-]*zip/i.test(text)) {
          return false;
        }

        return true;
      })
    : suggestions;

  // 4. Cache in 24-hour Redis Store only when search was grounded and verified
  const shouldCache = Boolean(isGrounded && finalSuggestions.length > 0);
  if (shouldCache) {
    try {
      if (resolveIsConnected()) {
        const redis = resolveRedisClient();
        await redis.set(cacheKey, JSON.stringify(finalSuggestions), 'EX', CACHE_TTL_SECONDS);
      } else {
        inMemoryProductCache.set(cacheKey, {
          suggestions: finalSuggestions,
          expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
        });
      }
    } catch (cacheSetErr) {
      logger.warn(`[ProductSearch] Cache write failed for key ${cacheKey}:`, cacheSetErr.message);
    }
  }

  return finalSuggestions;
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
