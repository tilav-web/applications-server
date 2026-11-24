/**
 * Yagona master ob'ektlar (fuqaro, karta, telefon, pasport, JSHSHIR) uchun
 * barcha servis va entity hook'larida bir xil normalizatsiya qoidalari.
 */

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
