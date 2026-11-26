/**
 * Yagona master ob'ektlar (fuqaro, karta, telefon, pasport, JSHSHIR) uchun
 * barcha servis va entity hook'larida bir xil normalizatsiya qoidalari.
 */

/**
 * Fuqaro F.I.SH. ni yagona toza formatga keltirish.
 * `full_name` berilgan bo'lsa uni ishlatadi; aks holda eski formatdagi
 * `last_name`, `first_name`, `middle_name` bo'laklarini birlashtirib beradi.
 */
export function normalizeCitizenFullName(
  input?:
    | string
    | {
        full_name?: string | null;
        last_name?: string | null;
        first_name?: string | null;
        middle_name?: string | null;
      }
    | null,
): string | null {
  if (!input) return null;
  const raw =
    typeof input === 'string'
      ? input
      : input.full_name?.trim() ||
        [input.last_name, input.first_name, input.middle_name]
          .map((p) => (p || '').trim())
          .filter(Boolean)
          .join(' ');
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : null;
}

/**
 * Yagona `full_name` satridan familiya, ism va otasining ismini ajratib olish
 * (faqat Word shablonlar va orqaga moslik uchun).
 */
export function splitFullNameParts(fullName?: string | null): {
  last_name: string;
  first_name: string;
  middle_name: string;
} {
  const cleaned = (fullName || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { last_name: '', first_name: '', middle_name: '' };
  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    return { last_name: parts[0], first_name: '', middle_name: '' };
  }
  if (parts.length === 2) {
    return { last_name: parts[0], first_name: parts[1], middle_name: '' };
  }
  return {
    last_name: parts[0],
    first_name: parts[1],
    middle_name: parts.slice(2).join(' '),
  };
}

/**
 * Pasport seriya va raqami: bo'shliqlar va chiziqchalarsiz, KATTA harflarda (masalan: "AB1234567").
 */
export function normalizePassport(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\s-]+/g, '').toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * JSHSHIR (PINFL): faqat raqamlar (14 xonali).
 */
export function normalizePinfl(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\D/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * O'zbekiston telefon raqami: faqat raqamlar, '+' siz;
 * 9 xonali lokal raqam (masalan 901234567) avtomatik 998 bilan to'ldiriladi -> 998901234567.
 */
export function normalizeUzPhone(value?: string | null): string | null {
  if (!value) return null;
  let cleaned = value.replace(/\D/g, '');
  if (!cleaned) return null;
  if (cleaned.length === 9) {
    cleaned = `998${cleaned}`;
  }
  return cleaned;
}

/**
 * Plastik karta raqami: faqat raqamlar (bo'shliq va chiziqchalarsiz).
 */
export function normalizeCardNumber(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\D/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * PostgreSQL LIKE / ILIKE qidiruvlarida wildcard belgilarni (`%`, `_`, `\`) zararsizlantirish.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * PostgreSQL unique_violation (23505) xatoligini aniqlash.
 */
export function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === '23505' || e.driverError?.code === '23505';
}
