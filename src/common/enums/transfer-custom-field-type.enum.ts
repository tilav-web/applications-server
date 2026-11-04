export enum TransferCustomFieldType {
  // 1. Primitivlar
  TEXT = 'TEXT', // Matn / izoh
  NUMBER = 'NUMBER', // Raqam / miqdor
  BOOLEAN = 'BOOLEAN', // Ha / Yo'q
  DATE = 'DATE', // Sana
  IMAGES = 'IMAGES', // Chek rasmlari
  FILES = 'FILES', // Kvitansiya / hujjat fayllari
  SELECT = 'SELECT', // Tanlov ro'yxati

  // 2. Transferga aloqador sub-modellar (Faqat birlik shakli)
  CARD = 'CARD', // Qo'shimcha karta
  CITIZEN = 'CITIZEN', // Vositachi / Pul oluvchi shaxs
  BANK = 'BANK', // Ishtirokchi bank
  PAYMENT_PROVIDER = 'PAYMENT_PROVIDER', // To'lov tizimi

  // Eski moslik uchun (Legacy)
  STRING = 'STRING',
}
