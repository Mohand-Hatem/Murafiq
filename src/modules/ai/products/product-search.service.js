/**
 * Phase 15E — Production External Product Search Service (product-search.service.js).
 *
 * Implements gap-closing product search using Google Search Grounding with Gemini 3.1 Flash Lite.
 * Integrates 24-hour Redis caching (ai:product-search:{season}:{gender}:{queryHash}),
 * true grounding support association, and live HTTP product page verification.
 */

import crypto from 'crypto';
import * as llmProvider from '../providers/llm.provider.js';
import { getRedisClient, isRedisConnected } from '../../../config/redis.config.js';
import { logger } from '../../../config/logger.config.js';
import {
  verifyProductPage,
  isAllowedHost,
  isRejectedUrlPath,
  hasProductPathIndicator,
  isItemInStock,
} from './product-page-verifier.js';

export const CACHE_TTL_SECONDS = 86_400; // 24 hours

export const PRODUCT_VERIFICATION_STATUS = Object.freeze({
  LIVE_VERIFIED: 'live_verified',
  GOOGLE_GROUNDED_ONLY: 'google_grounded_only',
  SEARCH_FALLBACK: 'search_fallback',
  REJECTED: 'rejected',
});

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
    match: /noon|نون/i,
    title: 'Noon Egypt',
    domain: 'noon.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=noon.com&sz=128',
    buildSearchUrl: (q) => `https://www.noon.com/egypt-ar/search/?q=${encodeURIComponent(q)}`,
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
    .replace(/[-–—/\\(),.:_#0-9]/g, ' ')
    .replace(/\b(فاخر|مميز|أنيق|عصري|كلاسيك|كلاسيكي|طبيعي|جداً|مريح|رسمي|للرجال|للنساء|رجالي|حريمي|موديل|تشكيلة)\b/g, ' ')
    .replace(/\b(luxury|classic|formal|comfortable|elegant|men|women|stylish|collection|genuine)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = raw.split(' ').filter(Boolean);
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
  const domain = known?.domain;
  if (domain) {
    return `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${cleanQ}`)}`;
  }
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

export const GARMENT_CATEGORY_TERMS = {
  shoes: ['shoes', 'shoe', 'oxford shoes', 'oxford shoe', 'oxfords', 'loafer', 'loafers', 'sneaker', 'sneakers', 'boot', 'boots', 'derby', 'derbies', 'heel', 'heels', 'sandals', 'footwear', 'حذاء', 'شوز', 'كوتشي', 'بوت', 'لوفر', 'أكسفورد', 'صندل'],
  top: ['shirt', 'shirts', 'tshirt', 't-shirt', 'blouse', 'polo', 'sweater', 'pullover', 'cardigan', 'hoodie', 'top', 'turtleneck', 'قميص', 'تيشيرت', 'بلوزة', 'بولو', 'سويتر', 'بلوفر', 'كارديجان', 'هودي', 'توب'],
  bottom: ['trousers', 'pants', 'jeans', 'chino', 'chinos', 'shorts', 'skirt', 'slacks', 'بنطلون', 'جينز', 'شينو', 'شورت', 'تنورة', 'جيبة'],
  outerwear: ['blazer', 'coat', 'jacket', 'tuxedo', 'suit', 'overcoat', 'parka', 'trench', 'بليزر', 'جاكيت', 'معطف', 'بدلة', 'توكسيدو', 'كوت'],
  dress: ['dress', 'gown', 'frock', 'jumpsuit', 'فستان', 'جمبسوت', 'عباية'],
  accessory: ['tie', 'bow-tie', 'belt', 'watch', 'cufflinks', 'scarf', 'bag', 'pocket-square', 'كرافتة', 'ربطة عنق', 'حزام', 'ساعة', 'أزرار', 'شال', 'حقيبة', 'شنطة'],
};

/**
 * Strips retailer SEO suffixes and store branding from a raw scraped page title.
 */
export const cleanRetailerTitle = (rawTitle = '') => {
  if (!rawTitle || typeof rawTitle !== 'string') return null;
  let clean = rawTitle.trim();
  clean = clean
    .replace(/\s*[-–—|:|•]\s*(Zara|Noon|Amazon|Jumia|Massimo Dutti|H&M|Mango|Defacto|LC Waikiki|Town Team|Tie House|Concrete|Mobaco|Dalydress|Lotfy|Dejavu|Jlood|Antikka|Namshi|ASOS).*$/i, '')
    .replace(/\s*[-–—|:|•]\s*(نون|جوميا|أمازون|زارا|ماسيمو دوتي|اتش اند ام|تاون تيم|كونكريت|دالي دريس|لطفي|ديجافو|مصر|Egypt).*$/i, '')
    .replace(/\s*[-–—|:|•]\s*(تسوق أونلاين|أفضل سعر|اشتري الآن|شحن مجاني).*$/i, '')
    .trim();

  return clean || rawTitle.trim();
};

/**
 * Validates that a verified product page matches the requested garment slot,
 * gender presentation, and key attributes.
 */
export const verifyPageProductMatch = (item = {}, pageVerification = {}, genderPresentation = 'unisex') => {
  if (!pageVerification || !pageVerification.valid) {
    return { matches: false, reason: 'page_invalid' };
  }

  const pageTitle = String(pageVerification.title || '').toLowerCase().trim();
  if (!pageTitle) {
    return { matches: true };
  }

  // 1. Gender Presentation alignment check
  const reqGender = String(genderPresentation || 'unisex').toLowerCase().trim();
  const isMenRequest = reqGender === 'men' || reqGender === 'male' || reqGender === 'رجالي';
  const isWomenRequest = reqGender === 'women' || reqGender === 'female' || reqGender === 'حريمي' || reqGender === 'نسائي';

  const hasFemaleTerms =
    /\b(women|women's|woman|ladies|lady)\b/i.test(pageTitle) ||
    /(^|\s)(حريمي|نسائي|بناتي)($|\s)/.test(pageTitle);
  const hasMaleTerms =
    /\b(men|men's|man|gentlemen)\b/i.test(pageTitle) ||
    /(^|\s)(رجالي|شبابي)($|\s)/.test(pageTitle);

  if (isMenRequest) {
    if (hasFemaleTerms && !hasMaleTerms) {
      return {
        matches: false,
        reason: 'gender_mismatch: requested men, page specifies women',
      };
    }
  } else if (isWomenRequest) {
    if (hasMaleTerms && !hasFemaleTerms) {
      return {
        matches: false,
        reason: 'gender_mismatch: requested women, page specifies men',
      };
    }
  }

  // 2. Slot / Category alignment check
  const targetSlot = String(item.slot || '').toLowerCase().trim();
  if (targetSlot && GARMENT_CATEGORY_TERMS[targetSlot]) {
    const targetTerms = GARMENT_CATEGORY_TERMS[targetSlot] || [];
    for (const [slot, terms] of Object.entries(GARMENT_CATEGORY_TERMS)) {
      if (slot !== targetSlot) {
        let pageHasOtherCategory = terms.some((t) => pageTitle.includes(t.toLowerCase()));
        let pageHasTargetCategory = targetTerms.some((t) => pageTitle.includes(t.toLowerCase()));

        // Disambiguate compound phrases:
        // 'dress shirt' / 'dress pants' contains 'dress' but belongs to top / bottom
        if (slot === 'dress' && (pageTitle.includes('dress shirt') || pageTitle.includes('dress pants'))) {
          pageHasOtherCategory = false;
        }
        if (targetSlot === 'dress' && (pageTitle.includes('dress shirt') || pageTitle.includes('dress pants'))) {
          pageHasTargetCategory = false;
        }

        if (pageHasOtherCategory && !pageHasTargetCategory) {
          return {
            matches: false,
            reason: `slot_mismatch: page belongs to ${slot}, expected ${targetSlot}`,
          };
        }
      }
    }
  }

  // 3. Overt Color Contradiction Check
  const itemText = `${item.title || ''} ${item.itemType || ''} ${item.description || ''}`.toLowerCase();
  const contrastingColors = [
    { target: ['black', 'أسود', 'اسود'], forbidden: ['white', 'أبيض', 'ابيض', 'pink', 'زهري', 'بمبي', 'yellow', 'أصفر'] },
    { target: ['white', 'أبيض', 'ابيض'], forbidden: ['black', 'أسود', 'اسود'] },
    { target: ['navy', 'كحلي'], forbidden: ['white', 'أبيض', 'pink', 'زهري', 'yellow', 'أصفر'] },
    { target: ['brown', 'بني'], forbidden: ['pink', 'زهري', 'white', 'أبيض'] },
  ];

  for (const rule of contrastingColors) {
    const itemSpecifiesColor = rule.target.some((c) => itemText.includes(c));
    if (itemSpecifiesColor) {
      const pageHasForbidden = rule.forbidden.some((c) => pageTitle.includes(c));
      const pageHasTarget = rule.target.some((c) => pageTitle.includes(c));
      if (pageHasForbidden && !pageHasTarget) {
        return {
          matches: false,
          reason: 'color_mismatch: requested color contradicts page title',
        };
      }
    }
  }

  return { matches: true };
};

/**
 * Extracts a product SKU or unique item ID from a product URL or image URL.
 */
export const extractProductSku = (url = '') => {
  if (!url || typeof url !== 'string') return null;
  // Noon: /p/(Z[A-Z0-9]+)/ or /<slug>/(Z[A-Z0-9]+)/p/ or /products/.../(Z[A-Z0-9]+) or /<SKU>_\d+\.jpg
  const noonMatch =
    url.match(/(?:\/p\/|\/products\/[^/]*\/)([ZN][A-Z0-9]{6,})/i) ||
    url.match(/\/([ZN][A-Z0-9]{6,})\/p(?:\/|$|\?)/i) ||
    url.match(/\/([ZN][A-Z0-9]{6,})_\d+\./i);
  if (noonMatch) return noonMatch[1].toUpperCase();

  // Amazon ASIN: /dp/([A-Z0-9]{10}) or /gp/product/([A-Z0-9]{10})
  const amazonMatch = url.match(/(?:\/dp\/|\/product\/)([A-Z0-9]{10})/i);
  if (amazonMatch) return amazonMatch[1].toUpperCase();

  // Jumia: -(\d{6,})\.html or /product/.../(\d{6,})
  const jumiaMatch = url.match(/[-_/](\d{6,})(?:\.html)?/i);
  if (jumiaMatch) return jumiaMatch[1];

  // Zara / Massimo Dutti / general: -p(\d{5,})\.html or -(\d{5,})\.html
  const generalMatch = url.match(/[-_]p?(\d{5,})/i);
  if (generalMatch) return generalMatch[1];

  return null;
};

/**
 * Validates whether a URL is an exact direct product page.
 * Rejects homepages, category pages, search results, and wrong categories.
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

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!isAllowedHost(hostname)) {
    return null;
  }

  // Reject dead lcwaikiki.com portal (Egyptian store uses lcwaikiki.eg)
  if (
    hostname === 'lcwaikiki.com' ||
    hostname.endsWith('.lcwaikiki.com') ||
    hostname === 'lcw.com' ||
    hostname.endsWith('.lcw.com')
  ) {
    return null;
  }

  if (isRejectedUrlPath(parsed)) {
    return null;
  }

  // Reject image or asset URLs
  const pathname = parsed.pathname.trim().toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|avif|svg)(\?.*)?$/i.test(pathname)) {
    return null;
  }

  // Require a concrete product-page indicator
  const isGoogleRedirector = hostname === 'vertexaisearch.cloud.google.com';
  if (!hasProductPathIndicator(parsed)) {
    return null;
  }

  // Google Grounding redirector will be checked after following redirect
  if (isGoogleRedirector) {
    return parsed.href;
  }

  // Product Category Conflict Check
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
          return null; // Mismatch
        }
      }
    }
  }

  return parsed.href;
};

/**
 * Validates whether an image URL is an exact verified direct product image.
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

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isStockOrPlaceholder = STOCK_AND_PLACEHOLDER_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
  if (isStockOrPlaceholder) {
    return null;
  }

  const fullImgTarget = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  const isRejectedPattern =
    /lookbook|campaign|editorial|placeholder|default[-_]?image|no[-_]?image|missing[-_]?image|banner|logo|avatar|icon|fallback|chatgpt|dummy|sample|download_[a-f0-9-]{10,}|\.svg$/i.test(
      fullImgTarget
    );
  if (isRejectedPattern) {
    return null;
  }

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

  // SKU correlation check if both define explicit SKUs
  if (hasDirectVerifiedSource) {
    const sourceSku = extractProductSku(verifiedSourceUrl);
    const imgSku = extractProductSku(parsed.href);
    if (sourceSku && imgSku) {
      const sNorm = sourceSku.replace(/^0+/, '').toLowerCase();
      const iNorm = imgSku.replace(/^0+/, '').toLowerCase();
      if (sNorm !== iNorm && !iNorm.includes(sNorm) && !sNorm.includes(iNorm)) {
        return null;
      }
    }

    const sourceSkuMatch = verifiedSourceUrl.match(/[-_]p?(\d{5,})/i);
    const imgSkuMatch = (parsed.pathname + parsed.search).match(/[-_/]p?(\d{5,})/i);
    if (sourceSkuMatch && imgSkuMatch && sourceSkuMatch[1] !== imgSkuMatch[1]) {
      const sDigits = sourceSkuMatch[1].replace(/^0+/, '');
      const iDigits = imgSkuMatch[1].replace(/^0+/, '');
      if (sDigits !== iDigits && !iDigits.includes(sDigits) && !sDigits.includes(iDigits)) {
        return null;
      }
    }
  }

  // Category conflict check
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
          return null;
        }
      }
    }
  }

  return parsed.href;
};

/**
 * Maps generated suggestions to their supporting Google Grounding chunks.
 * Avoids assuming array index alignment.
 */
export const mapSuggestionsToGrounding = (rawSuggestions = [], groundingMetadata = {}, rawResponseText = '') => {
  const chunks = Array.isArray(groundingMetadata?.groundingChunks)
    ? groundingMetadata.groundingChunks
    : [];
  const supports = Array.isArray(groundingMetadata?.groundingSupports)
    ? groundingMetadata.groundingSupports
    : [];

  const chunkList = chunks.map((c, idx) => ({
    index: idx,
    title: c.web?.title || 'Web Retailer',
    url: c.web?.uri || null,
  })).filter((c) => Boolean(c.url));

  return rawSuggestions.map((suggestion) => {
    const associatedChunkIndices = new Set();
    const sTitle = String(suggestion.title || '').trim().toLowerCase();
    const sType = String(suggestion.itemType || '').trim().toLowerCase();
    const sUrl = String(suggestion.sourceUrl || '').trim();

    let sStart = -1;
    let sEnd = -1;
    if (rawResponseText && sTitle) {
      sStart = rawResponseText.toLowerCase().indexOf(sTitle);
      if (sStart !== -1) {
        sEnd = sStart + sTitle.length + 300;
      }
    }

    for (const sup of supports) {
      const seg = sup.segment;
      const chunkIndices = sup.groundingChunkIndices || [];
      const segText = String(seg?.text || '').toLowerCase();

      const hasTextMatch =
        (sTitle && segText.includes(sTitle)) ||
        (sType && segText.includes(sType)) ||
        (sUrl && segText.includes(sUrl.toLowerCase()));

      const hasOffsetOverlap =
        sStart !== -1 &&
        typeof seg?.startIndex === 'number' &&
        typeof seg?.endIndex === 'number' &&
        seg.startIndex >= sStart &&
        seg.startIndex <= sEnd;

      if (hasTextMatch || hasOffsetOverlap) {
        for (const idx of chunkIndices) {
          if (idx >= 0 && idx < chunkList.length) {
            associatedChunkIndices.add(idx);
          }
        }
      }
    }

    // Direct domain / URL correlation with chunks
    for (const chunk of chunkList) {
      try {
        const chunkUri = chunk.url;
        if (sUrl && sUrl.toLowerCase() === chunkUri.toLowerCase()) {
          associatedChunkIndices.add(chunk.index);
        }

        const parsedChunk = new URL(chunkUri);
        const chunkHost = parsedChunk.hostname.toLowerCase();
        const chunkPath = parsedChunk.pathname.toLowerCase();
        const retInfo = getKnownRetailerInfo(suggestion.retailer);

        // Normalize URL paths for matching (ignoring query strings and trailing slashes)
        const normSUrl = sUrl ? sUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() : '';
        const normChunkUri = chunkUri.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
        if (normSUrl && (normSUrl === normChunkUri || normChunkUri.includes(normSUrl) || normSUrl.includes(normChunkUri))) {
          associatedChunkIndices.add(chunk.index);
        }

        // Compare extracted SKUs
        const sSku = extractProductSku(sUrl);
        const cSku = extractProductSku(chunkUri);
        if (sSku && cSku && sSku.toLowerCase() === cSku.toLowerCase()) {
          associatedChunkIndices.add(chunk.index);
        }

        if (retInfo?.domain && (chunkHost === retInfo.domain || chunkHost.endsWith(`.${retInfo.domain}`))) {
          const chunkText = `${chunkPath} ${chunk.title || ''}`.toLowerCase();
          const words = `${sTitle} ${sType}`
            .replace(/[^a-z0-9\u0600-\u06FF]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !['men', 'the', 'and', 'for', 'with', 'egypt', 'store', 'shop'].includes(w));
          const hasWordMatch = words.some((w) => chunkText.includes(w));
          const retailerChunkCount = chunkList.filter((c) => c.url.includes(retInfo.domain)).length;
          if (hasWordMatch || retailerChunkCount === 1) {
            associatedChunkIndices.add(chunk.index);
          }
        }
      } catch {
        // ignore
      }
    }

    const citations = Array.from(associatedChunkIndices)
      .map((idx) => chunkList[idx])
      .filter(Boolean)
      .map((c) => ({ title: c.title, url: c.url }));

    return {
      suggestion,
      citations,
      hasGroundingEvidence: citations.length > 0,
    };
  });
};

// Controlled concurrency helper
export const mapConcurrent = async (items, concurrency, fn) => {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
};

// Mock overrides
let redisOverride = null;
let isConnectedOverride = null;
const inMemoryProductCache = new Map();

export const setProductSearchRedisOverride = (client, isConnFn = null) => {
  redisOverride = client;
  isConnectedOverride = isConnFn;
};

export const clearInMemoryProductCache = () => {
  inMemoryProductCache.clear();
};

const resolveRedisClient = () => redisOverride || getRedisClient();
const resolveIsConnected = () =>
  isConnectedOverride ? isConnectedOverride() : isRedisConnected();

export const computeCacheKey = (
  query,
  {
    season = 'all',
    genderPresentation = 'unisex',
    locale = 'en',
    formality = 'formal',
    occasion = 'formal',
    budget = null,
    isShoppingRequest = false,
    anchor = null,
    gapItems = [],
    constraints = [],
  } = {}
) => {
  const normQuery = String(query || '').toLowerCase().trim();
  const normSeason = String(season || 'all').toLowerCase().trim();
  const normGender = String(genderPresentation || 'unisex').toLowerCase().trim();
  const normLocale = String(locale || 'en').toLowerCase().trim();
  const normFormality = String(formality || 'formal').toLowerCase().trim();
  const normOccasion = String(occasion || 'formal').toLowerCase().trim();
  const normBudget = budget !== undefined && budget !== null ? String(budget) : 'none';
  const normShopping = isShoppingRequest ? '1' : '0';
  const normAnchor = anchor
    ? typeof anchor === 'object'
      ? `${anchor._id || ''}:${anchor.colorFamily || ''}:${anchor.subcategory || anchor.category || ''}`
      : String(anchor)
    : 'none';
  const normGaps = Array.isArray(gapItems)
    ? gapItems.map((g) => `${g.slot || ''}:${g.description || ''}`).sort().join(';')
    : '';
  const normConstraints = Array.isArray(constraints)
    ? constraints.map((c) => String(c).toLowerCase().trim()).sort().join(';')
    : '';

  const rawContext = `${normQuery}|${normFormality}|${normOccasion}|${normBudget}|${normShopping}|${normAnchor}|${normGaps}|${normConstraints}`;
  const queryHash = crypto.createHash('sha256').update(rawContext).digest('hex').slice(0, 16);

  return `ai:product-search:${normSeason}:${normGender}:${normLocale}:${queryHash}`;
};

/**
 * Executes an external product search using Google Search Grounding to close wardrobe gaps.
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
  constraints = [],
  onCacheMiss = null,
} = {}) => {
  const query = String(gapDescription || '').trim();
  if (!query) {
    return [];
  }

  const cacheKey = computeCacheKey(query, {
    season,
    genderPresentation,
    locale,
    formality,
    occasion,
    budget,
    isShoppingRequest,
    anchor,
    gapItems,
    constraints,
  });

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

  // 2. Cache miss: trigger onCacheMiss callback if provided (e.g. atomic quota consumption)
  if (typeof onCacheMiss === 'function') {
    const proceed = await onCacheMiss();
    if (proceed === false) {
      return [];
    }
  }

  // 2. Perform Grounded Product Search using Gemini + Google Search Tool
  const langPrompt =
    locale === 'ar'
      ? 'CRITICAL ARABIC REQUIREMENT: The user speaks Arabic. You MUST formulate the response entirely in elegant, modern Arabic (العربية). All product titles (title), item types (itemType), detailed styling descriptions (description), and retailer names or translations MUST be in Arabic. Do not output English words unless referring to international brand names.'
      : 'Write product titles, descriptions, and rationales in fluent, elegant English.';

  const itemFields = `  * slot: garment category (top, bottom, shoes, outerwear, accessory, dress)
  * itemType: specific fashion garment type
  * title: exact descriptive title
  * retailer: retailer name in Egypt
  * estimatedPriceEgp: estimated price in EGP (only if verified in search results)
  * sourceUrl: exact verified direct product page URL from search results. NEVER provide a homepage, search page, or category page.
  * sourceTitle: store product title
  * imageUrl: product image URL from the store catalog or CDN. NEVER use stock photos, Unsplash, or placeholders.
  * description: detailed styling description.`;

  const anchorDesc = anchor
    ? [anchor.colorFamily, anchor.subcategory || anchor.category].filter(Boolean).join(' ')
    : null;

  const targetSlotsText = Array.isArray(gapItems) && gapItems.length > 0
    ? gapItems.map((g) => g.slot).join(', ')
    : 'bottom, shoes';

  const genderRule = `STRICT SINGLE-GENDER CONSISTENCY RULE:
- All suggested outfits MUST be designed for the SAME individual matching gender presentation: "${genderPresentation}".`;

  const directUrlRule = `CRITICAL DIRECT PRODUCT URL REQUIREMENT:
- EVERY suggested item MUST have a valid, direct product page URL (sourceUrl) found in your Google Search results.
- STRICT URL FORMAT RULES FOR EGYPTIAN MARKETPLACES:
  * Noon Egypt (noon.com): Valid product URLs MUST contain "/p/" and a product SKU (for example: https://www.noon.com/egypt-en/product-title/Z1234567890/p/ or https://www.noon.com/egypt-ar/.../p/). Category, department, or listing URLs (such as /men-s-fashion/..., /clothing/..., /shirts/..., /casual-shirts/, /all-products/) are STRICTLY FORBIDDEN and will be rejected. You MUST locate an individual product page containing "/p/".
  * Amazon Egypt (amazon.eg): Valid product URLs MUST contain "/dp/" followed by a 10-character ASIN (for example: https://www.amazon.eg/dp/B08XYZ1234). Search pages (/s?k=...) or category pages (/b?node=...) are STRICTLY FORBIDDEN.
  * Jumia Egypt (jumia.com.eg): Valid product URLs MUST end with ".html" for a single specific product.
- Direct product page URLs take absolute precedence. If you find multiple direct product page URLs on Noon Egypt (noon.com), RETURN THEM ALL FROM NOON EGYPT! Do NOT switch to another retailer unless you also have a verified direct product page URL on that retailer.
- NEVER return an item with null, empty, or missing sourceUrl.`;

  const suggestionRule = isShoppingRequest
    ? (anchor
        ? `ANCHOR-COMPLEMENTARY OUTFIT RULE:
- The user already owns this anchor piece: "${anchorDesc || 'anchor garment'}".
- You MUST find complementary pieces to complete the look WITH this anchor garment.
- STRICT EXCLUSION: NEVER recommend items of the same category or fashion type as the anchor (e.g. if the anchor is a sweater, pullover, or top, DO NOT suggest sweaters, pullovers, or tops).
- Generate distinct coordinated looks pairing with the anchor garment from slots: ${targetSlotsText}.
- ${directUrlRule}
- ${genderRule}
- Each item must specify:
${itemFields}
  * outfitIndex: outfit group number (1 or 2)
  * outfitTitle: localized outfit name.`
        : `TWO-OUTFIT RULE (COMPLETE LOOK MODE):
- Search live e-commerce stores delivering in Egypt for a complete look.
- Generate distinct coordinated outfits.
- ${directUrlRule}
- ${genderRule}
- Each item must specify:
${itemFields}
  * outfitIndex: outfit group number (1 or 2)
  * outfitTitle: localized outfit name.`)
    : `ACQUISITION SUGGESTIONS:
- Search live Egyptian retailers for real pieces to close wardrobe gaps.
- ${directUrlRule}
- ${genderRule}
- Each item must specify:
${itemFields}`;

  const systemPrompt = `You are the Murafiq Senior Fashion Personal Shopper in Egypt.
Search the live web for currently purchasable products in Egypt (Cairo, Alexandria, online retail).

MANDATORY RETAILER SEARCH PRIORITY (EGYPT):
You MUST search for purchasable fashion products on the following websites in this EXACT priority order:
1. Noon Egypt (noon.com)
2. Amazon Egypt (amazon.eg)
3. Jumia Egypt (jumia.com.eg)
First find available items on Noon, Amazon Egypt, and Jumia Egypt in that exact order. Only if suitable pieces cannot be found on these top three marketplaces, search other trusted retailers delivering in Egypt (Zara Egypt, Massimo Dutti, H&M Egypt, DeFacto, LC Waikiki, Mango, Concrete, Town Team, Mobaco Cottons, Dalydress, etc.).

CRITICAL DIRECT PRODUCT URL REQUIREMENT:
- EVERY recommended piece MUST have a valid, verified direct product page URL (sourceUrl) linking directly to the product detail page (e.g. noon.com/.../p/ or amazon.eg/dp/...).
- FOR NOON EGYPT (noon.com): The URL MUST contain "/p/" and a product SKU. Category or department links (e.g. /men-s-fashion/..., /clothing/..., /shirts/..., /casual-shirts/) are STRICTLY PROHIBITED.
- FOR AMAZON EGYPT (amazon.eg): The URL MUST contain "/dp/". Search links (/s?k=...) are STRICTLY PROHIBITED.
- NEVER return null, empty string, or search/category links for sourceUrl.
- If you find suitable complementary items on Noon Egypt, return them with their noon.com product URLs. Do NOT pick another store (like Amazon) if you only have a search URL or no direct product URL for that store.
- Direct product page links and actual product image URLs are MANDATORY for all pieces.

STRICT ANTI-HALLUCINATION RULES:
- Return ONLY products that you can identify from actual live search results.
- Do NOT invent fake URLs, fake SKUs, fake prices, or fake images.
- For each piece, provide the retailer and direct product page URL found in search.

${suggestionRule}

${langPrompt}`;

  const budgetClause = budget ? ` Target Budget: ~${budget} EGP.` : '';
  const constraintsClause =
    Array.isArray(constraints) && constraints.length > 0
      ? `\nExplicit Constraints: ${constraints.join(', ')}.`
      : '';
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
Gender Presentation: ${genderPresentation}${budgetClause}${constraintsClause}${langClause}`;

  let result;

  try {
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
    logger.warn('[ProductSearch] Grounded search execution failed. Failing closed without fabricating products:', searchErr.message);
    return []; // Fail closed per Section 20
  }

  // 3. Map Suggestions to Grounding Evidence
  const groundingMetadata = result?.groundingMetadata || {};
  const maxSuggestions = isShoppingRequest ? 6 : 2;
  const rawSuggestions = Array.isArray(result?.data?.suggestions)
    ? result.data.suggestions.slice(0, maxSuggestions)
    : [];
  const rawText = JSON.stringify(result?.data || {});

  const mappedGrounding = mapSuggestionsToGrounding(rawSuggestions, groundingMetadata, rawText);

  // 4. Verify Candidate URLs & Product Pages in Parallel with Concurrency Control
  const verifiedSuggestions = await mapConcurrent(mappedGrounding, 3, async ({ suggestion: s, citations, hasGroundingEvidence }) => {
    const knownRetailer = getKnownRetailerInfo(s.retailer);
    const searchUrl = buildRetailerSearchUrl(s.retailer, s.title || s.itemType || '');

    // Gather candidate URLs in priority: grounded citations first, then candidate sourceUrl
    const candidateUrls = [
      ...citations.map((c) => c.url),
      s.sourceUrl,
    ].filter(Boolean);

    logger.debug?.(
      `[ProductSearch] Evaluating ${candidateUrls.length} candidate URLs for item "${s.title || s.itemType}": ${JSON.stringify(candidateUrls)}`
    );

    let resolvedUrl = null;
    let resolvedPageTitle = null;
    let resolvedTitle = null;
    let resolvedImageUrl = null;
    let resolvedPrice = null;
    let resolvedCitations = [];
    let resolvedAvailability = null;
    let resolvedCurrency = 'EGP';
    let resolvedVerificationStatus = PRODUCT_VERIFICATION_STATUS.SEARCH_FALLBACK;
    let isLiveVerified = false;

    for (const candUrl of candidateUrls) {
      if (!candUrl || candUrl.includes('vertexaisearch.cloud.google.com')) {
        continue;
      }

      const syntaxVerified = verifyDirectProductUrl(candUrl, s, citations);
      if (!syntaxVerified || syntaxVerified.includes('vertexaisearch.cloud.google.com')) {
        logger.debug?.(
          `[ProductSearch] candUrl failed syntax check: ${candUrl} (item: "${s.title || s.itemType}")`
        );
        continue;
      }

      // Verify live product page over HTTP
      const pageVerification = await verifyProductPage(syntaxVerified, { timeoutMs: 5000 });
      if (pageVerification.valid) {
        if (pageVerification.finalUrl && pageVerification.finalUrl.includes('vertexaisearch.cloud.google.com')) {
          continue;
        }

        // Strict Currency Gate: reject foreign currencies (USD, GBP, EUR, AED)
        if (pageVerification.currency && String(pageVerification.currency).trim().toUpperCase() !== 'EGP') {
          logger.debug?.(
            `[ProductSearch] candUrl rejected due to non-EGP currency (${pageVerification.currency}): ${syntaxVerified}`
          );
          continue;
        }

        // Strict Stock Gate: reject out-of-stock items
        if (pageVerification.availability && isItemInStock(pageVerification.availability) === false) {
          logger.debug?.(
            `[ProductSearch] candUrl rejected due to out of stock (${pageVerification.availability}): ${syntaxVerified}`
          );
          continue;
        }

        // Deterministic Product Page Attribute Match Check
        const match = verifyPageProductMatch(s, pageVerification, genderPresentation);
        if (!match.matches) {
          logger.debug?.(
            `[ProductSearch] candUrl rejected due to attribute mismatch (${match.reason}): ${syntaxVerified}`
          );
          continue;
        }

        logger.debug?.(`[ProductSearch] HTTP verification passed for ${syntaxVerified}`);
        resolvedUrl = pageVerification.finalUrl || syntaxVerified;
        
        // Scraped page title is the primary canonical source of truth for product identity
        resolvedPageTitle = cleanRetailerTitle(pageVerification.title);
        resolvedTitle =
          resolvedPageTitle ||
          citations.find((c) => c.url === candUrl)?.title ||
          s.sourceTitle ||
          knownRetailer?.title ||
          s.retailer;
        resolvedPrice =
          pageVerification.currency && String(pageVerification.currency).trim().toUpperCase() !== 'EGP'
            ? null
            : pageVerification.price || (typeof s.estimatedPriceEgp === 'number' ? s.estimatedPriceEgp : null);

        if (pageVerification.blockedByBotGuard) {
          resolvedVerificationStatus = PRODUCT_VERIFICATION_STATUS.GOOGLE_GROUNDED_ONLY;
          isLiveVerified = false;
          resolvedAvailability = 'unknown';
        } else {
          resolvedVerificationStatus = PRODUCT_VERIFICATION_STATUS.LIVE_VERIFIED;
          isLiveVerified = true;
          resolvedAvailability =
            pageVerification.availability && isItemInStock(pageVerification.availability) === false
              ? 'out_of_stock'
              : 'in_stock';
        }
        resolvedCurrency = 'EGP';

        // Validate image URL: prefer verified candidate image from grounding, fallback to live page image
        if (s.imageUrl) {
          const verifiedSImg = verifyProductImageUrl(s.imageUrl, s, resolvedUrl);
          if (verifiedSImg) resolvedImageUrl = verifiedSImg;
        }
        if (!resolvedImageUrl && pageVerification.imageUrl) {
          resolvedImageUrl = verifyProductImageUrl(pageVerification.imageUrl, s, resolvedUrl);
        }

        resolvedCitations = citations.filter((c) => c.url === candUrl);
        if (resolvedCitations.length === 0) {
          resolvedCitations = [{ title: resolvedTitle || 'Retailer Product', url: resolvedUrl }];
        }
        break;
      } else if (hasGroundingEvidence && (citations.some((c) => c.url === candUrl) || (candUrl === s.sourceUrl && citations.length > 0))) {
        // If HTTP page scraping was blocked by anti-bot challenges (403/503 Cloudflare/Akamai/Amazon check),
        // but the URL was directly grounded by Google Search Grounding citations:
        // Preserve the Google Search verified real product URL so sourceUrl is never null!
        if (syntaxVerified.includes('vertexaisearch.cloud.google.com')) {
          continue;
        }
        resolvedUrl = syntaxVerified;
        resolvedTitle =
          citations.find((c) => c.url === candUrl)?.title ||
          s.sourceTitle ||
          knownRetailer?.title ||
          s.retailer;
        resolvedPrice = typeof s.estimatedPriceEgp === 'number' ? s.estimatedPriceEgp : null;
        resolvedAvailability = 'unknown';
        resolvedCurrency = 'EGP';
        resolvedVerificationStatus = PRODUCT_VERIFICATION_STATUS.GOOGLE_GROUNDED_ONLY;
        isLiveVerified = false;

        if (s.imageUrl) {
          const verifiedSImg = verifyProductImageUrl(s.imageUrl, s, resolvedUrl);
          if (verifiedSImg) resolvedImageUrl = verifiedSImg;
        }

        resolvedCitations = citations.filter((c) => c.url === candUrl);
        if (resolvedCitations.length === 0) {
          resolvedCitations = [{ title: resolvedTitle || 'Retailer Product', url: resolvedUrl }];
        }
        break;
      }
    }

    if (!resolvedUrl) {
      resolvedVerificationStatus = PRODUCT_VERIFICATION_STATUS.SEARCH_FALLBACK;
      isLiveVerified = false;
      resolvedAvailability = null;
    }

    const isGrounded = Boolean((hasGroundingEvidence || resolvedCitations.length > 0) && resolvedUrl && resolvedImageUrl);

    return {
      slot: s.slot || 'accessory',
      itemType: s.itemType || s.title || 'Fashion Garment',
      title: resolvedPageTitle || s.title || 'Suggested Piece',
      description: s.description || '',
      estimatedPriceEgp: resolvedPrice,
      currency: resolvedCurrency,
      availability: resolvedAvailability,
      verificationStatus: resolvedVerificationStatus,
      isLiveVerified,
      retailer: s.retailer || knownRetailer?.title || 'Online Retailer',
      sourceUrl: resolvedUrl,
      sourceTitle: resolvedTitle || s.sourceTitle || null,
      searchUrl,
      imageUrl: resolvedImageUrl,
      citations: isGrounded ? resolvedCitations : [],
      isGrounded,
      outfitIndex: typeof s.outfitIndex === 'number' ? s.outfitIndex : null,
      outfitTitle: s.outfitTitle || null,
      cacheHit: false,
    };
  });

  // 5. Post-Processing & Deduplication
  const finalSuggestions = verifiedSuggestions.filter((item) => {
    // If anchor is provided, strictly exclude anchor category & duplicates
    if (anchor) {
      const isAnchorTop =
        anchor.category === 'top' ||
        (anchor.category === 'outerwear' &&
          /sweater|pullover|knit|hoodie|cardigan|sweatshirt|quarter[_\s-]*zip/i.test(
            `${anchor.subcategory || ''} ${anchor.styleTags?.join(' ') || ''}`
          ));

      if (isAnchorTop && item.slot === 'top') return false;
      if (item.slot === anchor.category) return false;

      const text = `${item.title} ${item.itemType}`.toLowerCase();
      if (isAnchorTop && /كنزة|بلوفر|سترة صوفية|سويتر|sweater|pullover|knitwear|quarter[_\s-]*zip/i.test(text)) {
        return false;
      }
    }
    return true;
  });

  // 6. Cache only when verified results exist
  const verifiedCount = finalSuggestions.filter((s) => s.isGrounded).length;
  if (verifiedCount > 0) {
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
  AUTHENTIC_RETAILER_IMAGE_DOMAINS,
  KNOWN_RETAILERS,
  getKnownRetailerInfo,
  cleanSearchQuery,
  buildRetailerSearchUrl,
  buildRetailerLogoUrl,
  verifyDirectProductUrl,
  verifyProductImageUrl,
  mapSuggestionsToGrounding,
  mapConcurrent,
  setProductSearchRedisOverride,
  clearInMemoryProductCache,
  computeCacheKey,
  searchExternalProducts,
};
