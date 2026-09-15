/**
 * Localized static refusal templates for the AI Stylist Scope Guard (Layer 3).
 *
 * Keeping refusal copy static and localized prevents prompt injection attacks
 * and ensures reliable, non-steerable brand safety in both Arabic and English.
 */

export const REFUSAL_CATEGORIES = Object.freeze({
  GENERAL_KNOWLEDGE: 'general_knowledge',
  OTHER_DOMAIN: 'other_domain',
  UNSAFE: 'unsafe',
  RATE_LIMITED: 'rate_limited',
  INVALID_INPUT: 'invalid_input',
  NON_GARMENT_IMAGE: 'non_garment_image',
});

export const REFUSAL_TEMPLATES = Object.freeze({
  [REFUSAL_CATEGORIES.GENERAL_KNOWLEDGE]: {
    en: "I'm your Murafiq AI Stylist. I can help with clothing, outfits, styling, dress codes, wardrobe recommendations, and fashion-related shopping. I can't help with general knowledge or non-fashion topics.",
    ar: 'أنا منسق الأزياء الذكي من مٌرافق. يمكنني مساعدتك في تنسيق الملابس والإطلالات، قواعد اللباس، وتوصيات خزانة ملابسك وتسوق الأزياء. لا يمكنني الإجابة عن أسئلة المعرفة العامة.',
  },
  [REFUSAL_CATEGORIES.OTHER_DOMAIN]: {
    en: "I'm your Murafiq AI Stylist, focused exclusively on fashion, styling, and clothing. I cannot assist with topics outside of fashion and wardrobe styling.",
    ar: 'أنا منسق الأزياء الذكي من مٌرافق، ومختص فقط بالأزياء وتنسيق الملابس. لا يمكنني المساعدة في مواضيع خارج هذا النطاق.',
  },
  [REFUSAL_CATEGORIES.UNSAFE]: {
    en: "I cannot fulfill this request as it does not comply with Murafiq's safety and usage guidelines.",
    ar: 'عذراً، لا يمكنني الاستجابة لهذا الطلب لأنه يخالف إرشادات الاستخدام والسلامة الخاصة بمٌرافق.',
  },
  [REFUSAL_CATEGORIES.RATE_LIMITED]: {
    en: 'You have reached the limit of out-of-domain requests for this hour. Please try again later with fashion and styling requests.',
    ar: 'لقد تجاوزت الحد المسموح به للطلبات غير المتعلقة بالأزياء لهذه الساعة. يرجى المحاولة لاحقاً بأسئلة تتعلق بالأزياء وتنسيق الملابس.',
  },
  [REFUSAL_CATEGORIES.INVALID_INPUT]: {
    en: 'Please provide a valid styling request (between 1 and 500 characters).',
    ar: 'يرجى تقديم طلب تنسيق ملابس صالح (بين 1 و 500 حرف).',
  },
  [REFUSAL_CATEGORIES.NON_GARMENT_IMAGE]: {
    en: "The image you uploaded doesn't appear to be a clothing item. Please share a photo of a garment — such as a shirt, pants, dress, or shoes — and I'll help you style it!",
    ar: 'الصورة التي أرسلتها لا تبدو لقطعة ملابس. يرجى مشاركة صورة لقطعة ملابس — مثل قميص أو بنطلون أو فستان أو حذاء — وسأساعدك في تنسيقها!',
  },
});

/**
 * Returns a deterministic, localized refusal message for a given category and language.
 *
 * @param {string} [category='other_domain']
 * @param {'ar'|'en'} [language='en']
 * @returns {string}
 */
export const getRefusalMessage = (category = REFUSAL_CATEGORIES.OTHER_DOMAIN, language = 'en') => {
  const langKey = language === 'ar' ? 'ar' : 'en';
  const categoryKey = REFUSAL_TEMPLATES[category] ? category : REFUSAL_CATEGORIES.OTHER_DOMAIN;
  return REFUSAL_TEMPLATES[categoryKey][langKey];
};

export default {
  REFUSAL_CATEGORIES,
  REFUSAL_TEMPLATES,
  getRefusalMessage,
};
