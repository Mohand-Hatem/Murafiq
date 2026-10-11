/**
 * Stylist Response Renderer.
 *
 * Consumes strictly structured data (hydrated Mongo wardrobe documents, validated
 * composition outputs, and localized constants). Never consumes or echoes raw user
 * prompts, preventing prompt injection bypasses (Defense in Depth Layer 3).
 */

const ACQUISITION_TEMPLATES = Object.freeze({
  shoes: {
    formal: {
      en: 'Polished formal leather dress shoes, oxfords, or classic evening heels',
      ar: 'حذاء جلدي رسمي أنيق، أو كعب سهرة كلاسيكي',
    },
    casual: {
      en: 'Clean minimalist white sneakers or casual leather loafers',
      ar: 'حذاء رياضي أنيق أو حذاء لوفر كاجوال مريح',
    },
  },
  outerwear: {
    formal: {
      en: 'Tailored suit jacket, blazer, or structured evening coat',
      ar: 'بليزر كلاسيكي مفصل، أو جاكيت بدلة رسمي، أو معطف سهرة أنيق',
    },
    casual: {
      en: 'Lightweight jacket, casual overshirt, or classic trench coat',
      ar: 'جاكيت خفيف كاجوال، أو قميص خارجي عصري، أو معطف ترنش أنيق',
    },
  },
  accessory: {
    formal: {
      en: 'Fine leather dress belt, cufflinks, pocket square, or statement jewelry',
      ar: 'حزام جلدي رسمي، أو أزرار أكمام، أو إكسسوارات سهرة متناسقة',
    },
    casual: {
      en: 'Minimalist leather watch, sunglasses, or everyday accessories',
      ar: 'ساعة يد كلاسيكية، أو نظارة شمسية، أو إكسسوارات بسيطة',
    },
  },
  top: {
    formal: {
      en: 'Crisp tailored dress shirt or elegant evening blouse',
      ar: 'قميص رسمي مفصل عالي الجودة أو بلوزة سهرة أنيقة',
    },
    casual: {
      en: 'Premium cotton t-shirt, polo, or casual button-down shirt',
      ar: 'تيشيرت قطني فاخر، أو قميص بولو، أو قميص كاجوال أنيق',
    },
  },
  bottom: {
    formal: {
      en: 'Tailored dress trousers, wool suit pants, or formal skirt',
      ar: 'بنطلون قماشي رسمي مفصل، أو بنطلون بدلة، أو تنورة رسمية أنيقة',
    },
    casual: {
      en: 'Dark wash tailored jeans, clean chinos, or relaxed linen trousers',
      ar: 'بنطلون جينز داكن أنيق، أو بنطلون شينو كلاسيكي، أو بنطلون كتان',
    },
  },
  dress: {
    formal: {
      en: 'Full-length evening gown or elegant cocktail dress',
      ar: 'فستان سهرة طويل أنيق أو فستان كوكتيل راقٍ',
    },
    casual: {
      en: 'Chic daytime midi dress or relaxed linen summer dress',
      ar: 'فستان ميدي كاجوال أنيق أو فستان صيفي مريح',
    },
  },
});

export const getStylistBookingCta = (language = 'en') => {
  if (language === 'ar') {
    return 'هل تحتاج لمساعدة احترافية في تنسيق هذه المناسبة أو تسوق القطع الناقصة؟ احجز استشارة خاصة مع منسق أزياء معتمد من مٌرافق للحصول على إطلالة متكاملة.';
  }
  return 'Need expert assistance styling this event or shopping for missing wardrobe pieces? Book a verified Murafiq stylist for personalized 1-on-1 consultation.';
};

export const generateAcquisitionSuggestions = (
  missingSlots = [],
  formality = 'casual',
  language = 'en'
) => {
  const langKey = language === 'ar' ? 'ar' : 'en';
  const isFormal = ['formal', 'business', 'smart_casual', 'black_tie', 'white_tie'].includes(formality);
  const formalityKey = isFormal ? 'formal' : 'casual';

  return missingSlots.map((slot) => {
    const slotKey = String(slot).toLowerCase();
    const template = ACQUISITION_TEMPLATES[slotKey]?.[formalityKey] || {
      en: `Complementary ${slotKey} appropriate for ${formality} occasions`,
      ar: `قطعة ${slotKey} مناسبة للمناسبات من نمط ${formality}`,
    };

    return {
      slot: slotKey,
      description: template[langKey] || template.en,
    };
  });
};

/**
 * Returns a localized concrete gap description for a specific slot and formality.
 *
 * @param {string} slot
 * @param {string} [formality='formal']
 * @param {'ar'|'en'} [language='en']
 * @returns {string}
 */
export const getLocalizedGapDescription = (
  slot,
  formality = 'formal',
  language = 'en'
) => {
  const langKey = language === 'ar' ? 'ar' : 'en';
  const slotKey = String(slot).toLowerCase();

  // If exact formality template exists (e.g. 'formal', 'casual')
  const directTemplate = ACQUISITION_TEMPLATES[slotKey]?.[formality];
  if (directTemplate && directTemplate[langKey]) {
    return directTemplate[langKey];
  }

  // If standard mapped formality exists
  if (['business', 'smart_casual'].includes(formality)) {
    const template = ACQUISITION_TEMPLATES[slotKey]?.formal;
    if (template && template[langKey]) return template[langKey];
  }

  return langKey === 'ar' ? `${formality} ${slot}` : `${formality} ${slot}`;
};

export const ARABIC_CATEGORY_NAMES = Object.freeze({
  top: 'ملابس علوية',
  bottom: 'ملابس سفلية',
  shoes: 'حذاء',
  outerwear: 'معطف / جاكيت',
  accessory: 'إكسسوار',
  dress: 'فستان',
  others: 'قطعة ملابس',
});

export const ARABIC_SUBCATEGORY_NAMES = Object.freeze({
  t_shirt: 'تيشيرت',
  't-shirt': 'تيشيرت',
  tshirt: 'تيشيرت',
  shirt: 'قميص',
  dress_shirt: 'قميص رسمي',
  'dress shirt': 'قميص رسمي',
  blouse: 'بلوزة',
  polo: 'قميص بولو',
  sweater: 'سويتر',
  knitwear: 'سويتر تريكو',
  hoodie: 'هودي',
  sweatshirt: 'سويت شيرت',
  cardigan: 'كارديجان',
  tank_top: 'توب كت',
  'tank top': 'توب كت',
  top: 'توب',
  jeans: 'بنطلون جينز',
  trousers: 'بنطلون قماشي',
  pants: 'بنطلون',
  dress_pants: 'بنطلون بدلة',
  'dress pants': 'بنطلون بدلة',
  suit_trousers: 'بنطلون بدلة رسمية',
  'suit trousers': 'بنطلون بدلة رسمية',
  chinos: 'بنطلون شينو',
  skirt: 'تنورة',
  shorts: 'شورت',
  leggings: 'ليجن',
  sweatpants: 'بنطلون رياضي',
  blazer: 'بليزر',
  suit_jacket: 'جاكيت بدلة',
  'suit jacket': 'جاكيت بدلة',
  jacket: 'جاكيت',
  leather_jacket: 'جاكيت جلد',
  'leather jacket': 'جاكيت جلد',
  coat: 'معطف',
  trench_coat: 'معطف ترنش',
  'trench coat': 'معطف ترنش',
  overcoat: 'معطف شتوي',
  parka: 'باركا',
  vest: 'سديري',
  dress: 'فستان',
  evening_dress: 'فستان سهرة',
  'evening dress': 'فستان سهرة',
  evening_gown: 'فستان سهرة طويل',
  'evening gown': 'فستان سهرة طويل',
  cocktail_dress: 'فستان كوكتيل',
  'cocktail dress': 'فستان كوكتيل',
  jumpsuit: 'جمبسوت',
  suit: 'بدلة كاملة',
  sneakers: 'حذاء رياضي',
  running_shoes: 'حذاء ركض رياضي',
  'running shoes': 'حذاء ركض رياضي',
  loafers: 'حذاء لوفر',
  oxfords: 'حذاء أوكسفورد رسمي',
  oxford_shoes: 'حذاء أوكسفورد رسمي',
  'oxford shoes': 'حذاء أوكسفورد رسمي',
  dress_shoes: 'حذاء رسمي',
  'dress shoes': 'حذاء رسمي',
  boots: 'بوت',
  ankle_boots: 'هاف بوت',
  'ankle boots': 'هاف بوت',
  heels: 'حذاء كعب',
  sandals: 'صندل',
  slippers: 'سليبر',
  belt: 'حزام',
  watch: 'ساعة يد',
  tie: 'ربطة عنق',
  bowtie: 'بابيون',
  pocket_square: 'منديل جيب',
  'pocket square': 'منديل جيب',
  cufflinks: 'أزرار أكمام',
  bag: 'حقيبة',
  handbag: 'حقيبة يد',
  backpack: 'حقيبة ظهر',
  scarf: 'وشاح',
  hat: 'قبعة',
  sunglasses: 'نظارة شمسية',
  jewelry: 'مجوهرات',
});

export const ARABIC_COLOR_NAMES = Object.freeze({
  black: 'أسود',
  white: 'أبيض',
  navy: 'كحلي',
  blue: 'أزرق',
  light_blue: 'سماوي',
  'light blue': 'سماوي',
  dark_blue: 'أزرق داكن',
  'dark blue': 'أزرق داكن',
  grey: 'رمادي',
  gray: 'رمادي',
  charcoal: 'فحمي',
  beige: 'بيج',
  brown: 'بني',
  tan: 'بني فاتح',
  camel: 'جملي',
  cream: 'كريمي',
  off_white: 'أوف وايت',
  'off white': 'أوف وايت',
  green: 'أخضر',
  olive: 'زيتي',
  dark_green: 'أخضر داكن',
  'dark green': 'أخضر داكن',
  sage: 'أخضر ميرمية',
  red: 'أحمر',
  burgundy: 'بورجوندي',
  maroon: 'مارون',
  wine: 'نبيذي',
  pink: 'وردي',
  rose: 'وردي',
  yellow: 'أصفر',
  mustard: 'خردلي',
  orange: 'برتقالي',
  purple: 'بنفسجي',
  violet: 'بنفسجي',
  lavender: 'لافندر',
  gold: 'ذهبي',
  silver: 'فضي',
});

/**
 * Generates a readable, localized display name for a wardrobe item.
 *
 * Checks explicit item.name or item.title first.
 * If absent, constructs a meaningful name from garment attributes
 * (color, subcategory, category) in English or Arabic.
 *
 * @param {Object} item
 * @param {'ar'|'en'} [language='en']
 * @returns {string}
 */
export const formatWardrobeItemName = (item, language = 'en') => {
  if (!item) return language === 'ar' ? 'قطعة ملابس' : 'Wardrobe Item';

  const explicitName = (item.name || item.title || '').trim();
  if (explicitName) return explicitName;

  const isAr = language === 'ar';
  const rawSubcategory = (item.subcategory || '').trim().toLowerCase();
  const rawCategory = (item.category || '').trim().toLowerCase();
  const rawColor = (item.primaryColor || item.colorFamily || '').trim().toLowerCase();

  if (isAr) {
    const arNoun = ARABIC_SUBCATEGORY_NAMES[rawSubcategory] ||
      ARABIC_CATEGORY_NAMES[rawCategory] ||
      (rawSubcategory ? rawSubcategory.replace(/_/g, ' ') : (rawCategory ? rawCategory : 'قطعة ملابس'));

    const arColor = ARABIC_COLOR_NAMES[rawColor];

    if (arColor && arNoun) {
      return `${arNoun} ${arColor}`;
    }
    return arNoun || 'قطعة ملابس';
  }

  const cleanSubcategory = rawSubcategory.replace(/_/g, ' ');
  const cleanCategory = rawCategory.replace(/_/g, ' ');
  const noun = cleanSubcategory || cleanCategory || 'Wardrobe Item';

  const formattedNoun = noun
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  if (rawColor) {
    const cleanColor = rawColor.replace(/_/g, ' ');
    const formattedColor = cleanColor
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return `${formattedColor} ${formattedNoun}`;
  }

  return formattedNoun;
};

/**
 * Renders the final user-facing response payload strictly from validated, hydrated data.
 *
 * @param {Object} params
 * @param {Array<Object>} [params.outfits=[]] - Validated outfits from composition step
 * @param {'good'|'partial'|'none'} [params.sufficiency='good']
 * @param {string[]} [params.missingSlots=[]]
 * @param {Map<string, Object>} [params.hydratedItemsMap=new Map()] - Map of itemId to full Mongo wardrobe doc
 * @param {'ar'|'en'} [params.language='en']
 * @param {Object} [params.resolvedDressCode={}]
 * @param {Array<Object>} [params.persistedOutfits=[]] - Persisted Outfit records from DB
 * @param {Object} [params.anchor=null] - Optional uploaded anchor garment
 * @param {Object} [params.matchResult=null] - Soft match result from matchWardrobeItem
 * @param {string} [params.messageId=null] - Associated AiMessage ID for save CTA
 * @returns {Object} Clean user response payload
 */
export const renderStylistResponse = ({
  outfits = [],
  sufficiency = 'good',
  missingSlots = [],
  gapDescriptions = [],
  externalSuggestions = [],
  hydratedItemsMap = new Map(),
  language = 'en',
  resolvedDressCode = {},
  persistedOutfits = [],
  anchor = null,
  matchResult = null,
  messageId = null,
  isShoppingRequest = false,
  searchQuotaBlocked = false,
}) => {
  const langKey = language === 'ar' ? 'ar' : 'en';
  const primaryFormality = resolvedDressCode.formality?.[0] || 'casual';

  const anchorGarment = anchor && !matchResult?.matched
    ? {
        id: anchor.id || 'anchor_item',
        name: formatWardrobeItemName(anchor, language),
        category: anchor.category || 'top',
        subcategory: anchor.subcategory || null,
        imageUrl: anchor.imageUrl || '',
        colorFamily: anchor.colorFamily || '',
        formality: anchor.formality || null,
        material: anchor.material || null,
        pattern: anchor.pattern || null,
        isAnchor: true,
      }
    : null;

  // Hydrate outfits with real item attributes and Cloudinary URLs
  // For explicit shopping requests, personal wardrobe outfits are suppressed (empty array)
  // so the client renders exclusively external acquisition cards without duplicate suggestions.
  const renderedOutfits = isShoppingRequest
    ? []
    : outfits.map((outfit, index) => {
    const itemIds = Array.isArray(outfit.itemIds) ? outfit.itemIds : [];
    const persisted = persistedOutfits[index];

    const fromYourWardrobe = itemIds
      .map((id) => {
        const item = hydratedItemsMap.get(String(id));
        if (!item) return null;
        return {
          itemId: item._id ? item._id.toString() : String(item.id || id),
          name: formatWardrobeItemName(item, language),
          category: item.category || 'top',
          subcategory: item.subcategory || null,
          imageUrl: item.imageUrl || '',
          primaryColor: item.primaryColor || '',
          formality: item.formality || null,
          material: item.material || null,
        };
      })
      .filter(Boolean);

    return {
      outfitId: persisted?._id ? persisted._id.toString() : null,
      score: outfit.score || 80,
      rationale: outfit.rationale || '',
      anchor: anchorGarment,
      fromYourWardrobe,
    };
  });

  // Build suggestedToAcquire — strictly isolated from owned wardrobe items
  let suggestedToAcquire = [];

  if (Array.isArray(externalSuggestions) && externalSuggestions.length > 0) {
    suggestedToAcquire = externalSuggestions.map((s) => ({
      slot: s.slot || 'accessory',
      itemType: s.itemType || s.title || 'Fashion Garment',
      title: s.title || 'Suggested Piece',
      description: s.description || '',
      estimatedPriceEgp: typeof s.estimatedPriceEgp === 'number' ? s.estimatedPriceEgp : null,
      retailer: s.retailer || 'Online Retailer',
      sourceUrl: s.sourceUrl || null,
      sourceTitle: s.sourceTitle || null,
      imageUrl: s.imageUrl || null,
      citations: Array.isArray(s.citations) ? s.citations : [],
      isGrounded: Boolean(s.isGrounded),
      outfitIndex: typeof s.outfitIndex === 'number' ? s.outfitIndex : null,
      outfitTitle: s.outfitTitle || null,
    }));
  } else if (isShoppingRequest && searchQuotaBlocked) {
    // For explicit shopping requests when quota is blocked, return empty suggestions rather than
    // misleading ungrounded cards with null URLs/retailers, so the UI can clearly present the upgrade CTA.
    suggestedToAcquire = [];
  } else if (
    (sufficiency !== 'good' && (missingSlots.length > 0 || gapDescriptions.length > 0)) ||
    Boolean(isShoppingRequest)
  ) {
    // Ungrounded fallback template shopping list when search is not performed
    if (Array.isArray(gapDescriptions) && gapDescriptions.length > 0) {
      suggestedToAcquire = gapDescriptions.map((desc, idx) => ({
        slot: missingSlots[idx] || 'item',
        itemType: desc,
        title: desc,
        description: desc,
        estimatedPriceEgp: null,
        retailer: null,
        sourceUrl: null,
        sourceTitle: null,
        imageUrl: null,
        citations: [],
        isGrounded: false,
      }));
    } else {
      const fallbackSlots = missingSlots.length > 0 ? missingSlots : ['top', 'bottom', 'shoes'];
      const templateSuggestions = generateAcquisitionSuggestions(fallbackSlots, primaryFormality, langKey);
      suggestedToAcquire = templateSuggestions.map((ts) => ({
        slot: ts.slot,
        itemType: ts.description,
        title: ts.description,
        description: ts.description,
        estimatedPriceEgp: null,
        retailer: null,
        sourceUrl: null,
        sourceTitle: null,
        imageUrl: null,
        citations: [],
        isGrounded: false,
      }));
    }
  }

  const suggestBookStylist = sufficiency === 'none' || sufficiency === 'partial' || Boolean(isShoppingRequest);

  const softMatchHint = matchResult?.matched
    ? (langKey === 'ar'
        ? `هل هذه القطعة تشبه "${matchResult.itemName || 'قطعتك'}" الموجودة في خزانة ملابسك؟`
        : `Does this look like your "${matchResult.itemName || 'item'}" from your wardrobe?`)
    : null;

  const canSaveToWardrobe = Boolean(anchor && !matchResult?.matched);
  const saveToWardrobeCta = canSaveToWardrobe
    ? (langKey === 'ar'
        ? 'هل تود حفظ هذه القطعة في خزانة ملابسك للمستقبل؟'
        : 'Would you like to save this piece to your wardrobe for future styling?')
    : null;

  return {
    outfits: renderedOutfits,
    sufficiency,
    missingSlots,
    gapDescriptions,
    suggestedToAcquire,
    suggestBookStylist,
    stylistBookingCta: suggestBookStylist ? getStylistBookingCta(langKey) : null,
    searchQuotaBlocked: Boolean(searchQuotaBlocked),
    productSearchUpgradeCta: searchQuotaBlocked
      ? (langKey === 'ar'
          ? 'خطتك الحالية لا تتضمن ميزة البحث في المتاجر الإلكترونية. قم بترقية باقتك للبحث عن قطع حقيقية وروابط شراء من المتاجر.'
          : 'Your current plan does not include online store product search. Upgrade your subscription to search real products and purchase links from online retailers.')
      : null,
    anchor: anchorGarment,
    matchHint: softMatchHint,
    canSaveToWardrobe,
    saveToWardrobeCta,
    saveMessageId: messageId ? String(messageId) : null,
    language: langKey,
  };
};

export default {
  renderStylistResponse,
  generateAcquisitionSuggestions,
  getLocalizedGapDescription,
  getStylistBookingCta,
  formatWardrobeItemName,
};
