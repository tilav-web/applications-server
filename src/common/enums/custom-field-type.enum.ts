export enum CustomFieldType {
  // 1. Oddiy ma'lumot turlari (Primitivlar)
  TEXT = 'TEXT', // Matn / izoh
  NUMBER = 'NUMBER', // Raqam / miqdor
  BOOLEAN = 'BOOLEAN', // Ha / Yo'q (switch/checkbox)
  DATE = 'DATE', // Sana
  IMAGES = 'IMAGES', // Rasmlar
  FILES = 'FILES', // Fayllar / Hujjatlar
  SELECT = 'SELECT', // Tanlov ro'yxati

  // 2. Aloqador sub-modellar (Faqat birlik shakli)
  CITIZEN = 'CITIZEN', // Fuqaro
  DISTRICT = 'DISTRICT', // Tuman / Bo'lim
  CRIME = 'CRIME', // Jinoyat moddasi
  CARD = 'CARD', // Plastik karta
  TRANSFER = 'TRANSFER', // Pul o'tkazmasi

  // Eski moslik uchun (Legacy)
  STRING = 'STRING',
}
