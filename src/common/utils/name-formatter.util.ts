/**
 * O'zbek tili ism-shariflari (F.I.SH) va matnlarni to'g'ri registrda (Proper/Title Case) formatlash utilitasi.
 * 
 * Qoidalar:
 * 1. Ismlar, familiyalar va shariflar har doim bosh harfi katta, qolganlari kichik bo'ladi:
 *    TILOVOV -> Tilovov
 *    SHAVQIDDIN -> Shavqiddin
 *    DONIYOROVICH -> Doniyorovich
 * 
 * 2. O'zbek tilida otasining ismi qo'shimchalari rasmiy hujjatlarda har doim kichik harfda yoziladi:
 *    "O'G'LI", "O‘G‘LI", "OʻGʻLI", "O`G`LI", "OG'LI", "OGLI" -> "o'g'li"
 *    "QIZI", "КИЗИ" -> "qizi"
 *    "ЎҒЛИ", "УГЛИ" -> "ўғли"
 * 
 * 3. Chiziqcha (defis) bilan keladigan qo'shma ismlar:
 *    GUL-ASAL -> Gul-Asal, SHER-ALI -> Sher-Ali
 * 
 * 4. To'liq F.I.SH:
 *    "TILOVOV SHAVQIDDIN SAYFIDDIN O'G'LI" -> "Tilovov Shavqiddin Sayfiddin o'g'li"
 */

const LOWERCASE_PARTICLES = new Set([
  "o'g'li",
  "o‘g‘li",
  "oʻgʻli",
  "o`g`li",
  "og'li",
  "ogli",
  "o'gli",
  "qizi",
  "қизи",
  "кизи",
  "ўғли",
  "угли",
  "ўғли",
  "уғли",
]);

/**
 * Ism, familiya yoki to'liq F.I.SH ni o'zbek tili qonuniyatlariga ko'ra formatlaydi.
 */
export function formatUzbekName(str?: string | null): string {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (!trimmed) return '';

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';

      // Apostroflarni solishtirish uchun tekshiramiz
      const normalizedForCheck = word
        .toLowerCase()
        .replace(/[\u2018\u2019\u02BB\u02BC\x60]/g, "'");

      if (
        LOWERCASE_PARTICLES.has(normalizedForCheck) ||
        LOWERCASE_PARTICLES.has(word.toLowerCase())
      ) {
        return word.toLowerCase();
      }

      // Defisli ismlar (masalan: Mirzo-Ulug'bek, Gul-Asal)
      if (word.includes('-')) {
        return word
          .split('-')
          .map((sub) => {
            if (!sub) return '';
            return sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase();
          })
          .join('-');
      }

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Bank, to'lov tizimi, jinoyat turi kabi nomlarni to'g'ri registrga o'tkazish
 * Masalan: "FIRIBGARLIK" -> "Firibgarlik", "AGROBANK" -> "Agrobank"
 */
export function formatTitleCase(str?: string | null): string {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (!trimmed) return '';

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

