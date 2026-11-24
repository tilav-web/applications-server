/**
 * O'zbek (va rus) Krill alifbosini yagona standart Lotin alifbosiga (ASCII apostrof `'`)
 * o'girish hamda apostroflarni normallashtirish utilitasi.
 *
 * Barcha kiruvchi ma'lumotlar (saqlash va qidirish) shu yagona standartga keltiriladi:
 * - Ў/ў -> O'/o', Ғ/ғ -> G'/g', Ъ/ъ -> '
 * - Barcha apostrof turlari (‘ ’ ʻ ʼ ` ´) -> oddiy ASCII '
 * - Ruscha harflar: Щ/щ -> Sh/sh (ALL-CAPS da SH), Ы/ы -> I/i, Ь/ь -> olib tashlanadi
 * - ALL-CAPS so'zlarda digraphlar to'liq katta harfda chiqadi: ШАҲРИСАБЗ -> SHAHRISABZ, АҚШ -> AQSH
 */

const CYR_SINGLE_MAP: Record<string, string> = {
  А: 'A',
  а: 'a',
  Б: 'B',
  б: 'b',
  В: 'V',
  в: 'v',
  Г: 'G',
  г: 'g',
  Д: 'D',
  д: 'd',
  Ж: 'J',
  ж: 'j',
  З: 'Z',
  з: 'z',
  И: 'I',
  и: 'i',
  Й: 'Y',
  й: 'y',
  К: 'K',
  к: 'k',
  Л: 'L',
  л: 'l',
  М: 'M',
  м: 'm',
  Н: 'N',
  н: 'n',
  О: 'O',
  о: 'o',
  П: 'P',
  п: 'p',
  Р: 'R',
  р: 'r',
  С: 'S',
  с: 's',
  Т: 'T',
  т: 't',
  У: 'U',
  у: 'u',
  Ф: 'F',
  ф: 'f',
  Х: 'X',
  х: 'x',
  Ҳ: 'H',
  ҳ: 'h',
  Қ: 'Q',
  қ: 'q',
  Э: 'E',
  э: 'e',
  Ы: 'I',
  ы: 'i',
};

const CYR_DIGRAPH_UPPER: Record<string, [string, string]> = {
  Ш: ['Sh', 'SH'],
  Ч: ['Ch', 'CH'],
  Щ: ['Sh', 'SH'],
  Ё: ['Yo', 'YO'],
  Ю: ['Yu', 'YU'],
  Я: ['Ya', 'YA'],
  Ц: ['Ts', 'TS'],
};

const CYR_DIGRAPH_LOWER: Record<string, string> = {
  ш: 'sh',
  ч: 'ch',
  щ: 'sh',
  ё: 'yo',
  ю: 'yu',
  я: 'ya',
  ц: 'ts',
};

const VOWELS = new Set([
  'А',
  'Е',
  'Ё',
  'И',
  'О',
  'У',
  'Э',
  'Ю',
  'Я',
  'Ў',
  'Ы',
  'а',
  'е',
  'ё',
  'и',
  'о',
  'у',
  'э',
  'ю',
  'я',
  'ў',
  'ы',
  'A',
  'E',
  'I',
  'O',
  'U',
  'a',
  'e',
  'i',
  'o',
  'u',
]);

const HARD_OR_SOFT_SIGN = new Set(['Ъ', 'ъ', 'Ь', 'ь']);

const APOSTROPHE_REGEX = /[\u2018\u2019\u02BB\u02BC\u02B9\u0060\u00B4]/g;
const HAS_CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const LETTER_OR_DIGIT_REGEX = /[\p{L}\p{N}]/u;
const UPPERCASE_LETTER_REGEX = /\p{Lu}/u;
const LOWERCASE_LETTER_REGEX = /\p{Ll}/u;

const LEGAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/САНКЦИЯ/g, 'SANKSIYA'],
  [/Санкция/g, 'Sanksiya'],
  [/санкция/g, 'sanksiya'],
  [/ТРАНЗАКЦИЯ/g, 'TRANZAKSIYA'],
  [/Транзакция/g, 'Tranzaksiya'],
  [/транзакция/g, 'tranzaksiya'],
  [/КОМПЕНСАЦИЯ/g, 'KOMPENSATSIYA'],
  [/Компенсация/g, 'Kompensatsiya'],
  [/компенсация/g, 'kompensatsiya'],
  [/ИДЕНТИФИКАЦИЯ/g, 'IDENTIFIKATSIYA'],
  [/Идентификация/g, 'Identifikatsiya'],
  [/идентификация/g, 'identifikatsiya'],
  [/ПРОЦЕССУАЛ/g, 'PROTSESSUAL'],
  [/Процессуал/g, 'Protsessual'],
  [/процессуал/g, 'protsessual'],
  [/ПРОЦЕССИНГ/g, 'PROTSESSING'],
  [/Процессинг/g, 'Protsessing'],
  [/процессинг/g, 'protsessing'],
];

/**
 * Barcha Unicode apostrof variantlarini oddiy ASCII `'` belgisiga keltiradi.
 */
export function normalizeApostrophes(text: string): string {
  if (!text) return '';
  return text.replace(APOSTROPHE_REGEX, "'");
}

function isAllCapsContext(chars: string[], index: number): boolean {
  const next = index + 1 < chars.length ? chars[index + 1] : '';
  const prev = index > 0 ? chars[index - 1] : '';

  if (next && UPPERCASE_LETTER_REGEX.test(next)) return true;
  if (next && LOWERCASE_LETTER_REGEX.test(next)) return false;
  if (prev && UPPERCASE_LETTER_REGEX.test(prev)) return true;
  return false;
}

/**
 * Krill (o'zbek va rus) matnni standart Lotin alifbosiga o'giradi va apostroflarni
 * oddiy `'` belgisiga normallashtiradi.
 */
export function cyrillicToLatinNormalized(text: string): string {
  if (!text) return '';

  // Tezkor yo'l: agar matnda krill harfi bo'lmasa, faqat apostroflarni normallashtiramiz
  if (!HAS_CYRILLIC_REGEX.test(text)) {
    return normalizeApostrophes(text);
  }

  let s = text;
  for (const [pattern, replacement] of LEGAL_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }

  const chars = Array.from(s);
  const out: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const prev = i > 0 ? chars[i - 1] : '';

    if (c === 'Ў') {
      out.push("O'");
    } else if (c === 'ў') {
      out.push("o'");
    } else if (c === 'Ғ') {
      out.push("G'");
    } else if (c === 'ғ') {
      out.push("g'");
    } else if (c === 'Ъ' || c === 'ъ') {
      out.push("'");
    } else if (c === 'Ь' || c === 'ь') {
      // Yumshatish belgisi o'zbek lotinida tushirib qoldiriladi
      continue;
    } else if (c === 'Е' || c === 'е') {
      const isStart = i === 0 || !LETTER_OR_DIGIT_REGEX.test(prev);
      const isAfterVowelOrSign = VOWELS.has(prev) || HARD_OR_SOFT_SIGN.has(prev);
      if (isStart || isAfterVowelOrSign) {
        if (c === 'Е') {
          out.push(isAllCapsContext(chars, i) ? 'YE' : 'Ye');
        } else {
          out.push('ye');
        }
      } else {
        out.push(c === 'Е' ? 'E' : 'e');
      }
    } else if (c in CYR_DIGRAPH_UPPER) {
      const [titleForm, upperForm] = CYR_DIGRAPH_UPPER[c];
      out.push(isAllCapsContext(chars, i) ? upperForm : titleForm);
    } else if (c in CYR_DIGRAPH_LOWER) {
      out.push(CYR_DIGRAPH_LOWER[c]);
    } else if (c in CYR_SINGLE_MAP) {
      out.push(CYR_SINGLE_MAP[c]);
    } else {
      out.push(c);
    }
  }

  return normalizeApostrophes(out.join(''));
}

export function normalizeToLatin(text: string): string {
  return cyrillicToLatinNormalized(text);
}
