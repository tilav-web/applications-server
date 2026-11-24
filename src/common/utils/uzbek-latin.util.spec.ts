import { cyrillicToLatinNormalized, normalizeApostrophes } from './uzbek-latin.util';

describe('uzbek-latin.util', () => {
  it('converts standard Uzbek Cyrillic words and places to ASCII-apostrophe Latin', () => {
    expect(cyrillicToLatinNormalized('Қарши шаҳри')).toBe('Qarshi shahri');
    expect(cyrillicToLatinNormalized('Ғузор тумани')).toBe("G'uzor tumani");
    expect(cyrillicToLatinNormalized('Ўзбекистон')).toBe("O'zbekiston");
    expect(cyrillicToLatinNormalized('Бўстон МФЙ')).toBe("Bo'ston MFY");
    expect(cyrillicToLatinNormalized('Маъмурий')).toBe("Ma'muriy");
  });

  it('handles ALL-CAPS Cyrillic words and digraphs properly', () => {
    expect(cyrillicToLatinNormalized('ШАҲРИСАБЗ')).toBe('SHAHRISABZ');
    expect(cyrillicToLatinNormalized('АҚШ')).toBe('AQSH');
    expect(cyrillicToLatinNormalized('ЧОРТОҚ')).toBe('CHORTOQ');
    expect(cyrillicToLatinNormalized('ЯККАБОҒ')).toBe("YAKKABOG'");
  });

  it('handles Russian Cyrillic letters Щ, Ы, Ь and Е/е context', () => {
    expect(cyrillicToLatinNormalized('Щербаков')).toBe('Sherbakov');
    expect(cyrillicToLatinNormalized('ЩЕРБАКОВ')).toBe('SHERBAKOV');
    expect(cyrillicToLatinNormalized('Рыбаков')).toBe('Ribakov');
    expect(cyrillicToLatinNormalized('Юрьев')).toBe('Yuryev');
    expect(cyrillicToLatinNormalized('область')).toBe('oblast');
    expect(cyrillicToLatinNormalized('Ермолов')).toBe('Yermolov');
    expect(cyrillicToLatinNormalized('Бекзод')).toBe('Bekzod');
    expect(cyrillicToLatinNormalized('Баённома')).toBe('Bayonnoma');
  });

  it('normalizes all Unicode apostrophe variants even on pure Latin input', () => {
    expect(normalizeApostrophes('G‘uzor Oʻzbekiston Ma’muriy O`g`li')).toBe(
      "G'uzor O'zbekiston Ma'muriy O'g'li",
    );
    expect(cyrillicToLatinNormalized('O‘qituvchi')).toBe("O'qituvchi");
  });

  it('handles legal terms accurately', () => {
    expect(cyrillicToLatinNormalized('Санкция ва транзакция')).toBe('Sanksiya va tranzaksiya');
    expect(cyrillicToLatinNormalized('САНКЦИЯ')).toBe('SANKSIYA');
  });
});
