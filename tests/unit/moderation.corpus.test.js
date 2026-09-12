import { describe, it, expect } from '@jest/globals';
import { scanText } from '../../src/modules/moderation/moderation.scanner.js';

describe('Moderation Scanner Corpus (Task S-12)', () => {
  const sampleBlockedWords = [
    { word: 'badword', severity: 'HIGH', category: 'PROFANITY' },
    { word: 'شتيمة', severity: 'CRITICAL', category: 'INSULT' },
    { word: 'harassmentterm', severity: 'MEDIUM', category: 'HARASSMENT' },
    { word: 'ass', severity: 'HIGH', category: 'PROFANITY' },
  ];

  const sampleBlockedDomains = ['spamsite.org', 'externaldeals.net', 'me'];

  const MUST_DETECT = [
    { text: 'كلمني على 01012345678 ضروري', desc: 'standard Egyptian mobile number' },
    { text: 'My number is 0 1 2 - 3 4 5 6 7 8 9 0', desc: 'spaced/hyphenated Egyptian number' },
    { text: 'واتس على ٠١١٢٣٤٥٦٧٨٩', desc: 'Arabic-Indic digits phone number' },
    { text: 'Contact me at +201512345678', desc: 'international +20 format' },
    { text: 'Check my portfolio at https://myportfolio.com/photos', desc: 'standard URL' },
    { text: 'Look here: bit.ly/mystyle', desc: 'shortened link' },
    { text: 'Follow me on instagram @stylist_egypt', desc: 'social media handle' },
    { text: 'ابعتلي على الواتساب', desc: 'Arabic WhatsApp mention' },
    { text: 'Pay me directly via instapay', desc: 'InstaPay mention' },
    { text: 'حول المبلغ على انستا باي', desc: 'Arabic InstaPay mention' },
    { text: 'ممكن فودافون كاش احسن؟', desc: 'Vodafone Cash mention' },
    { text: 'هندفع كاش بره الابلكيشن', desc: 'cash off-platform evasion' },
    { text: 'Visit spamsite.org for discounts', desc: 'blocked domain from denylist' },
    { text: 'Hello this is a badword test', desc: 'English blocked word' },
    { text: 'انت انسان شَتِيمَة جدا', desc: 'Arabic blocked word with tashkeel' },
    { text: 'Stop using harassmentterm now', desc: 'harassment term' },
    { text: 'You are an ass to deal with', desc: 'exact blocked word match' },
  ];

  const MUST_NOT_DETECT = [
    { text: 'Hello my name is Hassan and I would like to book a session', desc: 'Hassan containing substring ass' },
    { text: 'Please send a message containing me with details', desc: 'message containing me with domain me' },
    { text: 'welcome home, looking forward to meeting', desc: 'clean welcoming message' },
    { text: 'احتاج خبير تصفيف شعر لمناسبة مسائية في المعادي يوم الجمعة القادم', desc: 'standard Arabic booking request' },
    { text: 'Hello I would like to book a styling session for tomorrow afternoon', desc: 'standard English booking request' },
  ];

  it('MUST_DETECT: flags 100% of violation corpus entries', () => {
    for (const item of MUST_DETECT) {
      const result = scanText(item.text, sampleBlockedDomains, sampleBlockedWords);
      expect(result.isFlagged).toBe(true);
    }
  });

  it('MUST_NOT_DETECT: produces 0% false positives on clean corpus entries', () => {
    for (const item of MUST_NOT_DETECT) {
      const result = scanText(item.text, sampleBlockedDomains, sampleBlockedWords);
      expect(result.isFlagged).toBe(false);
    }
  });
});
