/**
 * Normalizes multi-lingual Arabic and English text for robust pattern matching.
 * Converts Arabic-Indic numerals, removes diacritics/tashkeel, tatweel, and zero-width spaces.
 * @param {string} text
 * @returns {string}
 */
export const normalizeText = (text) => {
  if (!text || typeof text !== 'string') return '';

  let normalized = text;

  // 1. Map Eastern Arabic-Indic numerals (٠-٩) and Persian numerals (۰-۹) to standard ASCII 0-9
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const persianNumerals = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  for (let i = 0; i < 10; i += 1) {
    normalized = normalized.split(arabicNumerals[i]).join(i.toString());
    normalized = normalized.split(persianNumerals[i]).join(i.toString());
  }

  // 2. Remove zero-width spaces and formatting control characters
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '');

  // 3. Remove Arabic diacritics (tashkeel: fathah, dammah, kasrah, tanween, sukun, shaddah) and tatweel
  normalized = normalized.replace(/[\u064B-\u0652\u0640]/g, '');

  // 4. Normalize Arabic letters with common spelling variations (أ إ آ -> ا, ة -> ه, ى -> ي)
  normalized = normalized
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

  return normalized;
};

// Egyptian phone number regex: detects 010, 011, 012, 015 or +2010... with optional separators
const EG_PHONE_REGEX = /(?:\+?20|0020)?[\s\-_./\\*#]*0?[\s\-_./\\*#]*1[\s\-_./\\*#]*[0125](?:[\s\-_./\\*#]*\d){8}/i;

// URL / external link detector
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*|[a-zA-Z0-9-]+\.(?:com|net|org|me|io|app|co|xyz|link|ly|gl|ai)(?:\/[^\s]*)?/i;

// Social handle / platform mentions (supports English & Arabic with prefix articles: الـ, بالـ, فالـ)
const SOCIAL_REGEX = /(?:@[\w.]{3,30})|(?:^|[^\p{L}\p{N}])(?:whatsapp|what'?s\s*app|(?:[وفكب]?ال|[وفكب])?(?:واتساب|واتس|انستجرام|انستا|تليجرام|فيسبوك|سناب|تيك\s*توك)|instagram|insta|telegram|facebook|fb|snapchat|tiktok)(?:$|[^\p{L}\p{N}])/iu;

// Off-platform payment solicitation (supports English & Arabic with prefix articles)
const PAYMENT_EVASION_REGEX = /(?:^|[^\p{L}\p{N}])(?:instapay|insta\s*pay|(?:[وفكب]?ال|[وفكب])?(?:انستاباي|انستا\s*باي|فودافون\s*كاش|اورنج\s*كاش|اتصالات\s*كاش|وي\s*باي|كاش\s*بره|تحويل\s*بره|تحويل\s*خارجي|بره\s*الابلكيشن)|vodafone\s*cash|we\s*pay|off[\s-]*platform|cash\s*in\s*hand|الدفع\s*كاش\s*يدوي)(?:$|[^\p{L}\p{N}])/iu;

/**
 * Scans text for off-platform communication, URLs, and payment evasion patterns.
 * Scans text for off-platform communication, URLs, payment evasion patterns, and blocked words.
 * @param {string} rawText
 * @param {string[]} [blockedDomains=[]]
 * @param {Array<{word: string, severity?: string, category?: string}>|string[]} [blockedWords=[]]
 * @returns {{ isFlagged: boolean, matchedLayer?: string, matchedRule?: string, severity?: string, detectedPatterns: string[] }}
 */
export const scanText = (rawText, blockedDomains = [], blockedWords = []) => {
  if (!rawText || typeof rawText !== 'string') {
    return { isFlagged: false, detectedPatterns: [] };
  }

  const normalized = normalizeText(rawText);
  const detectedPatterns = [];
  let matchedLayer = null;
  let matchedRule = null;
  let detectedSeverity = 'MEDIUM';

  // 1. Check Egyptian Phone Numbers
  const phoneMatch = normalized.match(EG_PHONE_REGEX);
  if (phoneMatch) {
    detectedPatterns.push(`PHONE_NUMBER: ${phoneMatch[0]}`);
    matchedLayer = 'REGEX_CONTACT';
    matchedRule = 'EGYPTIAN_PHONE_NUMBER';
  }

  // 2. Check URLs & Links
  const urlMatch = normalized.match(URL_REGEX);
  if (urlMatch) {
    detectedPatterns.push(`URL: ${urlMatch[0]}`);
    if (!matchedLayer) {
      matchedLayer = 'DOMAIN_DENYLIST';
      matchedRule = 'EXTERNAL_URL';
    }
  }

  // 3. Check Social Handles & Platforms
  const socialMatch = normalized.match(SOCIAL_REGEX);
  if (socialMatch) {
    detectedPatterns.push(`SOCIAL_MEDIA: ${socialMatch[0]}`);
    if (!matchedLayer) {
      matchedLayer = 'WORD_LIST';
      matchedRule = 'SOCIAL_MEDIA_HANDLE';
    }
  }

  // 4. Check Payment Evasion Terms
  const paymentMatch = normalized.match(PAYMENT_EVASION_REGEX);
  if (paymentMatch) {
    detectedPatterns.push(`PAYMENT_EVASION: ${paymentMatch[0]}`);
    if (!matchedLayer) {
      matchedLayer = 'WORD_LIST';
      matchedRule = 'PAYMENT_EVASION_TERM';
    }
  }

  // 5. Check explicitly Blocked Domains
  if (blockedDomains && blockedDomains.length > 0) {
    const lowerText = normalized.toLowerCase();
    for (const domain of blockedDomains) {
      if (domain && lowerText.includes(domain.toLowerCase())) {
        detectedPatterns.push(`BLOCKED_DOMAIN: ${domain}`);
        matchedLayer = 'DOMAIN_DENYLIST';
        matchedRule = `BLOCKED_DOMAIN_${domain.toUpperCase()}`;
        break;
      }
    }
  }

  // 6. Check explicitly Blocked Words (dictionary-based lexicon)
  if (blockedWords && blockedWords.length > 0) {
    const lowerText = normalized.toLowerCase();
    for (const item of blockedWords) {
      const wordStr = typeof item === 'string' ? item : item.word;
      if (!wordStr) continue;

      const normWord = normalizeText(wordStr).toLowerCase().trim();
      if (!normWord) continue;

      const wordRegex = new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${normWord.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`,
        'iu'
      );
      if (wordRegex.test(lowerText) || lowerText.includes(normWord)) {
        detectedPatterns.push(`BLOCKED_WORD: ${wordStr}`);
        if (!matchedLayer) {
          matchedLayer = 'WORD_LIST';
          matchedRule = `BLOCKED_WORD_${normWord.toUpperCase().replace(/\s+/g, '_')}`;
        }
        if (typeof item === 'object' && item.severity) {
          detectedSeverity = item.severity;
        }
        break;
      }
    }
  }

  return {
    isFlagged: detectedPatterns.length > 0,
    matchedLayer,
    matchedRule,
    severity: detectedSeverity,
    detectedPatterns,
  };
};

export default {
  normalizeText,
  scanText,
};
