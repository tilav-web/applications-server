import {
  adaptToScript,
  cyrillicToLatin,
  formatAmountNumber,
  formatDateUzbek,
  latinToCyrillic,
  numberToWordsUz,
} from './transliterate.util';

describe('transliterate.util', () => {
  describe('latinToCyrillic & cyrillicToLatin & adaptToScript', () => {
    it('transliterates Uzbek digraphs (O‘, G‘, Sh, Ch, Yo, Yu, Ya, Ye, Ts) and contextual E/Э', () => {
      expect(latinToCyrillic("O'zbekiston, G'uzor, Shavqiddin, Chiroqchi")).toBe(
        'Ўзбекистон, Ғузор, Шавқиддин, Чироқчи',
      );
      expect(latinToCyrillic('Ergashev va tergov')).toBe('Эргашев ва тергов');
      expect(latinToCyrillic("Ma'lumot")).toBe('Маълумот');
    });

    it('preserves letter case for special legal terms (sanksiya, tranzaksiya, protsessual)', () => {
      expect(latinToCyrillic('protsessual harakatlar')).toBe('процессуал ҳаракатлар');
      expect(latinToCyrillic('Protsessual qaror')).toBe('Процессуал қарор');
      expect(latinToCyrillic('SANKSIYA')).toBe('САНКЦИЯ');
      expect(latinToCyrillic('tranzaksiya')).toBe('транзакция');
    });

    it('adapts text automatically between Lotin and Krill scripts', () => {
      expect(adaptToScript('Қарши шаҳри', 'lotin')).toBe(cyrillicToLatin('Қарши шаҳри'));
      expect(adaptToScript('Qarshi shahri', 'lotin')).toBe('Qarshi shahri');
      expect(adaptToScript('Qarshi shahri', 'krill')).toBe('Қарши шаҳри');
      expect(adaptToScript('Қарши шаҳри', 'krill')).toBe('Қарши шаҳри');
      expect(adaptToScript('   ', 'lotin')).toBe('');
      expect(adaptToScript(null, 'krill')).toBe('');
    });
  });

  describe('formatAmountNumber', () => {
    it('formats numeric and space-separated string amounts properly without truncating at spaces', () => {
      expect(formatAmountNumber(3350000)).toBe('3 350 000');
      expect(formatAmountNumber('1 500 000')).toBe('1 500 000');
      expect(formatAmountNumber('250000.6')).toBe('250 001');
      expect(formatAmountNumber(0)).toBe('0');
      expect(formatAmountNumber(null)).toBe('0');
      expect(formatAmountNumber('invalid')).toBe('invalid');
    });
  });

  describe('formatDateUzbek', () => {
    it('formats dates in Lotin and Krill and returns empty string for invalid dates', () => {
      const d = new Date(2026, 10, 5); // 5 Nov 2026
      expect(formatDateUzbek(d, 'lotin')).toBe('«05» noyabr 2026 yil');
      expect(formatDateUzbek(d, 'krill')).toBe('«05» ноябрь 2026 йил');
      expect(formatDateUzbek('not-a-date', 'lotin')).toBe('');
    });
  });

  describe('numberToWordsUz', () => {
    it('converts amounts to Uzbek words in both Lotin and Krill including space-formatted strings', () => {
      expect(numberToWordsUz(0, 'lotin')).toBe('nol');
      expect(numberToWordsUz(0, 'krill')).toBe('ноль');
      expect(numberToWordsUz('1 500 000', 'lotin')).toBe('bir million besh yuz ming so‘m');
      expect(numberToWordsUz('1 500 000', 'krill')).toBe('бир миллион беш юз минг сўм');
      expect(numberToWordsUz(2_045_312, 'lotin')).toBe(
        "ikki million qirq besh ming uch yuz o'n ikki so‘m",
      );
      expect(numberToWordsUz('bad-number', 'lotin')).toBe('');
    });
  });
});
