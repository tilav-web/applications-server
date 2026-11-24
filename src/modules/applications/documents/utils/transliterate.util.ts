/**
 * O'zbek tili Lotin va Krill alifbolari o'rtasida o'girish utilitasi
 * Qonunchilik va rasmiy hujjatlar standartlariga to'liq moslangan.
 */

import { cyrillicToLatinNormalized } from '../../../../common/utils/uzbek-latin.util';

const LAT_TO_CYR_MAP: Record<string, string> = {
  A: 'А',
  a: 'а',
  B: 'Б',
  b: 'б',
  D: 'Д',
  d: 'д',
  F: 'Ф',
  f: 'ф',
  G: 'Г',
  g: 'г',
  H: 'Ҳ',
  h: 'ҳ',
  I: 'И',
  i: 'и',
  J: 'Ж',
  j: 'ж',
  K: 'К',
  k: 'к',
  L: 'Л',
  l: 'л',
  M: 'М',
  m: 'м',
  N: 'Н',
  n: 'н',
  O: 'О',
  o: 'о',
  P: 'П',
  p: 'п',
  Q: 'Қ',
  q: 'қ',
  R: 'Р',
  r: 'р',
  S: 'С',
  s: 'с',
  T: 'Т',
  t: 'т',
  U: 'У',
  u: 'у',
  V: 'В',
  v: 'в',
  X: 'Х',
  x: 'х',
  Y: 'Й',
  y: 'й',
  Z: 'З',
  z: 'з',
};

const VOWELS_CYR = new Set([
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
]);
const VOWELS_LAT = new Set(['A', 'E', 'I', 'O', 'U', 'a', 'e', 'i', 'o', 'u']);

export function cyrillicToLatin(text: string): string {
  return cyrillicToLatinNormalized(text);
}

export function latinToCyrillic(text: string): string {
  if (!text) return '';
  let s = text;

  // Normalize quotes
  s = s.replace(/[\u2018\u2019\u02BB\u02BC'`]/g, '’');

  // O‘, G‘
  s = s.replace(/O’|O‘|O`/g, 'Ў');
  s = s.replace(/o’|o‘|o`/g, 'ў');
  s = s.replace(/G’|G‘|G`/g, 'Ғ');
  s = s.replace(/g’|g‘|g`/g, 'ғ');

  // Sh, Ch
  s = s.replace(/SH/g, 'Ш').replace(/Sh/g, 'Ш').replace(/sh/g, 'ш');
  s = s.replace(/CH/g, 'Ч').replace(/Ch/g, 'Ч').replace(/ch/g, 'ч');

  // Yo, Yu, Ya, Ye
  s = s.replace(/YO/g, 'Ё').replace(/Yo/g, 'Ё').replace(/yo/g, 'ё');
  s = s.replace(/YU/g, 'Ю').replace(/Yu/g, 'Ю').replace(/yu/g, 'ю');
  s = s.replace(/YA/g, 'Я').replace(/Ya/g, 'Я').replace(/ya/g, 'я');
  s = s.replace(/YE/g, 'Е').replace(/Ye/g, 'Е').replace(/ye/g, 'е');

  // Sanksiya / tranzaksiya standard back to Cyrillic
  s = s.replace(/Sanksiya/gi, 'Санкция');
  s = s.replace(/Tranzaksiya/gi, 'Транзакция');
  s = s.replace(/Protsessual/gi, 'Процессуал');
  s = s.replace(/Protsessing/gi, 'Процессинг');

  // Ts
  s = s.replace(/TS/g, 'Ц').replace(/Ts/g, 'Ц').replace(/ts/g, 'ц');

  // Character-by-character
  const chars = Array.from(s);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const prev = i > 0 ? chars[i - 1] : '';

    if (c === 'E' || c === 'e') {
      const isStart = i === 0 || !/[\p{L}\p{N}]/u.test(prev);
      const isAfterVowel = VOWELS_CYR.has(prev) || VOWELS_LAT.has(prev);
      if (isStart || isAfterVowel) {
        out.push(c === 'E' ? 'Э' : 'э');
      } else {
        out.push(c === 'E' ? 'Е' : 'е');
      }
    } else if (c === '’') {
      out.push('ъ');
    } else if (c in LAT_TO_CYR_MAP) {
      out.push(LAT_TO_CYR_MAP[c]);
    } else {
      out.push(c);
    }
  }

  return out.join('');
}

/**
 * Matnni kerakli alifboga moslashtirish (targetScript: 'lotin' | 'krill')
 */
export function adaptToScript(
  text: string | null | undefined,
  targetScript: 'lotin' | 'krill',
): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  const hasCyrillic = /[\u0400-\u04FF]/.test(trimmed);

  if (targetScript === 'lotin') {
    return hasCyrillic ? cyrillicToLatin(trimmed) : trimmed;
  } else {
    return hasCyrillic ? trimmed : latinToCyrillic(trimmed);
  }
}

/**
 * Raqamlarni probel bilan guruhlash (masalan: 3350000 -> 3 350 000)
 */
export function formatAmountNumber(amount: number | string | null | undefined): string {
  if (!amount) return '0';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return String(amount);
  return Math.round(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Sanani o'zbekcha formatlash
 */
const MONTHS_LOTIN = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

const MONTHS_KRILL = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

export function formatDateUzbek(
  dateInput: Date | string | null | undefined,
  script: 'lotin' | 'krill' = 'lotin',
): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '';

  const day = String(d.getDate()).padStart(2, '0');
  const monthIdx = d.getMonth();
  const year = d.getFullYear();

  if (script === 'lotin') {
    return `«${day}» ${MONTHS_LOTIN[monthIdx]} ${year} yil`;
  } else {
    return `«${day}» ${MONTHS_KRILL[monthIdx]} ${year} йил`;
  }
}

/**
 * Raqamni so'z bilan ifodalash (Lotin va Krill)
 */
export function numberToWordsUz(
  amount: number | string | null | undefined,
  script: 'lotin' | 'krill' = 'lotin',
): string {
  if (!amount) return script === 'lotin' ? 'nol' : 'ноль';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '';

  const unitsLotin = [
    '',
    'bir',
    'ikki',
    'uch',
    "to'rt",
    'besh',
    'olti',
    'yetti',
    'sakkiz',
    "to'qqiz",
  ];
  const unitsKrill = ['', 'бир', 'икки', 'уч', 'тўрт', 'беш', 'олти', 'етти', 'саккиз', 'тўққиз'];
  const tensLotin = [
    '',
    "o'n",
    'yigirma',
    "o'ttiz",
    'qirq',
    'ellik',
    'oltmish',
    'yetmish',
    'sakson',
    "to'qson",
  ];
  const tensKrill = [
    '',
    'ўн',
    'йигирма',
    'ўттиз',
    'қирқ',
    'эллик',
    'олтмиш',
    'етмиш',
    'саксон',
    'тўқсон',
  ];
  const scalesLotin = ['', 'ming', 'million', 'milliard', 'trillion'];
  const scalesKrill = ['', 'минг', 'миллион', 'миллиард', 'триллион'];

  const units = script === 'lotin' ? unitsLotin : unitsKrill;
  const tens = script === 'lotin' ? tensLotin : tensKrill;
  const scales = script === 'lotin' ? scalesLotin : scalesKrill;
  const yuzWord = script === 'lotin' ? 'yuz' : 'юз';

  function convertGroup(n: number): string {
    const parts: string[] = [];
    const hundreds = Math.floor(n / 100);
    const remainder = n % 100;
    const t = Math.floor(remainder / 10);
    const u = remainder % 10;

    if (hundreds > 0) {
      parts.push(`${units[hundreds]} ${yuzWord}`);
    }
    if (t > 0) {
      parts.push(tens[t]);
    }
    if (u > 0) {
      parts.push(units[u]);
    }
    return parts.join(' ');
  }

  let current = Math.abs(Math.round(num));
  if (current === 0) return script === 'lotin' ? 'nol' : 'ноль';

  let scaleIdx = 0;
  const groups: string[] = [];

  while (current > 0) {
    const chunk = current % 1000;
    if (chunk > 0) {
      const chunkStr = convertGroup(chunk);
      const scaleStr = scales[scaleIdx] ? ` ${scales[scaleIdx]}` : '';
      groups.unshift(`${chunkStr}${scaleStr}`);
    }
    current = Math.floor(current / 1000);
    scaleIdx++;
  }

  const result = groups.join(' ').trim();
  const currencySuffix = script === 'lotin' ? 'so‘m' : 'сўм';
  return `${result} ${currencySuffix}`;
}
