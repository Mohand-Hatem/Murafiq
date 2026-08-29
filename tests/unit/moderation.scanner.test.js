import { describe, it, expect } from '@jest/globals';
import { normalizeText, scanText } from '../../src/modules/moderation/moderation.scanner.js';

describe('Moderation Scanner & Normalizer (Unit)', () => {
  describe('normalizeText', () => {
    it('converts Arabic-Indic digits ٠-٩ to standard ASCII 0-9', () => {
      const input = 'رقمي هو ٠١٠١٢٣٤٥٦٧٨';
      const output = normalizeText(input);
      expect(output).toContain('01012345678');
    });

    it('strips zero-width characters and Arabic diacritics/tashkeel', () => {
      const input = 'تَوَاصَلْ مَعِي\u200B';
      const output = normalizeText(input);
      expect(output).toBe('تواصل معي');
    });
  });

  describe('scanText — Egyptian Phone Numbers', () => {
    it('detects standard Egyptian mobile numbers', () => {
      const result = scanText('كلمني على 01012345678 ضروري');
      expect(result.isFlagged).toBe(true);
      expect(result.matchedLayer).toBe('REGEX_CONTACT');
      expect(result.matchedRule).toBe('EGYPTIAN_PHONE_NUMBER');
    });

    it('detects spaced and hyphenated Egyptian numbers', () => {
      const result = scanText('My number is 0 1 2 - 3 4 5 6 7 8 9 0');
      expect(result.isFlagged).toBe(true);
    });

    it('detects Arabic digits phone numbers', () => {
      const result = scanText('واتس على ٠١١٢٣٤٥٦٧٨٩');
      expect(result.isFlagged).toBe(true);
    });

    it('detects +20 international format', () => {
      const result = scanText('Contact me at +201512345678');
      expect(result.isFlagged).toBe(true);
    });
  });

  describe('scanText — External URLs & Links', () => {
    it('detects standard HTTP and HTTPS URLs', () => {
      const result = scanText('Check my portfolio at https://myportfolio.com/photos');
      expect(result.isFlagged).toBe(true);
      expect(result.detectedPatterns.some((p) => p.includes('URL'))).toBe(true);
    });

    it('detects bare domains like bit.ly or site.me', () => {
      const result = scanText('Look here: bit.ly/mystyle');
      expect(result.isFlagged).toBe(true);
    });
  });

  describe('scanText — Social Media & Off-Platform Keywords', () => {
    it('detects social media mentions and handles', () => {
      const result = scanText('Follow me on instagram @stylist_egypt');
      expect(result.isFlagged).toBe(true);
      expect(result.detectedPatterns.some((p) => p.includes('SOCIAL_MEDIA'))).toBe(true);
    });

    it('detects Arabic whatsapp mentions', () => {
      const result = scanText('ابعتلي على الواتساب');
      expect(result.isFlagged).toBe(true);
    });
  });

  describe('scanText — Off-Platform Payment Terms', () => {
    it('detects InstaPay mentions in English and Arabic', () => {
      const resEn = scanText('Pay me directly via instapay');
      const resAr = scanText('حول المبلغ على انستا باي');
      expect(resEn.isFlagged).toBe(true);
      expect(resAr.isFlagged).toBe(true);
    });

    it('detects Vodafone Cash mentions', () => {
      const result = scanText('ممكن فودافون كاش احسن؟');
      expect(result.isFlagged).toBe(true);
    });

    it('detects off-platform payment solicitation phrases', () => {
      const result = scanText('هندفع كاش بره الابلكيشن');
      expect(result.isFlagged).toBe(true);
    });
  });

  describe('scanText — Blocked Domains', () => {
    it('detects banned domains from the dynamic denylist', () => {
      const blockedDomains = ['spamsite.org', 'externaldeals.net'];
      const result = scanText('Visit spamsite.org for discounts', blockedDomains);
      expect(result.isFlagged).toBe(true);
      expect(result.detectedPatterns.some((p) => p.includes('BLOCKED_DOMAIN'))).toBe(true);
    });
  });

  describe('scanText — Clean Text', () => {
    it('passes standard service descriptions and clean communication without flagging', () => {
      const cleanText = 'احتاج خبير تصفيف شعر لمناسبة مسائية في المعادي يوم الجمعة القادم';
      const result = scanText(cleanText);
      expect(result.isFlagged).toBe(false);
      expect(result.detectedPatterns).toHaveLength(0);
    });
  });
});
