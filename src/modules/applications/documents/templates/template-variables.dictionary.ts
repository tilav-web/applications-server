export interface TemplateVariableItem {
  tag: string;              // e.g. '{{citizen.full_name}}'
  rawKey: string;           // e.g. 'citizen.full_name'
  label: string;            // e.g. 'Fuqaro F.I.Sh (To‘liq)'
  category: string;         // 'citizen' | 'app' | 'victim_card' | 'fraud_card' | 'transfers' | 'officer' | 'system'
  description?: string;
  sampleValue: string;
}

export interface TemplateCategoryConfig {
  id: string;
  label: string;
  iconName: string;
  items: TemplateVariableItem[];
}

export const TEMPLATE_VARIABLES_DICTIONARY: TemplateCategoryConfig[] = [
  {
    id: 'citizen',
    label: 'Fuqaro (Arizachi)',
    iconName: 'User',
    items: [
      {
        tag: '{{citizen.full_name}}',
        rawKey: 'citizen.full_name',
        label: 'Fuqaro F.I.Sh (To‘liq)',
        category: 'citizen',
        description: 'Fuqaroning to‘liq ismi, familiyasi va otasining ismi',
        sampleValue: 'Ergashev Sanjar To‘g‘aymurodovich',
      },
      {
        tag: '{{citizen.short_name}}',
        rawKey: 'citizen.short_name',
        label: 'Fuqaro F.I.Sh (Qisqa)',
        category: 'citizen',
        description: 'Masalan: S.Ergashev',
        sampleValue: 'S.Ergashev',
      },
      {
        tag: '{{citizen.first_name}}',
        rawKey: 'citizen.first_name',
        label: 'Ismi',
        category: 'citizen',
        sampleValue: 'Sanjar',
      },
      {
        tag: '{{citizen.last_name}}',
        rawKey: 'citizen.last_name',
        label: 'Familiyasi',
        category: 'citizen',
        sampleValue: 'Ergashev',
      },
      {
        tag: '{{citizen.middle_name}}',
        rawKey: 'citizen.middle_name',
        label: 'Otasining ismi',
        category: 'citizen',
        sampleValue: 'To‘g‘aymurodovich',
      },
      {
        tag: '{{citizen.passport}}',
        rawKey: 'citizen.passport',
        label: 'Pasport seriya va raqami',
        category: 'citizen',
        sampleValue: 'AA 1234567',
      },
      {
        tag: '{{citizen.pinfl}}',
        rawKey: 'citizen.pinfl',
        label: 'JSHSHIR (PINFL)',
        category: 'citizen',
        sampleValue: '30906781230012',
      },
      {
        tag: '{{citizen.phone}}',
        rawKey: 'citizen.phone',
        label: 'Telefon raqami',
        category: 'citizen',
        sampleValue: '+998901234567',
      },
      {
        tag: '{{citizen.birth_date}}',
        rawKey: 'citizen.birth_date',
        label: 'Tug‘ilgan sanasi (raqamda)',
        category: 'citizen',
        sampleValue: '1985-06-15',
      },
      {
        tag: '{{citizen.birth_date_text}}',
        rawKey: 'citizen.birth_date_text',
        label: 'Tug‘ilgan sanasi (so‘z bilan)',
        category: 'citizen',
        sampleValue: '«15» iyun 1985 yil',
      },
      {
        tag: '{{citizen.address}}',
        rawKey: 'citizen.address',
        label: 'To‘liq yashash manzili',
        category: 'citizen',
        sampleValue: 'Qarshi shahri, Mustaqillik MFY, 12-uy',
      },
      {
        tag: '{{citizen.district}}',
        rawKey: 'citizen.district',
        label: 'Yashash tumani',
        category: 'citizen',
        sampleValue: 'Qarshi shahri',
      },
      {
        tag: '{{citizen.mahalla}}',
        rawKey: 'citizen.mahalla',
        label: 'Yashash mahallasi',
        category: 'citizen',
        sampleValue: 'Mustaqillik MFY',
      },
      {
        tag: '{{citizen.workplace}}',
        rawKey: 'citizen.workplace',
        label: 'Ish joyi va lavozimi',
        category: 'citizen',
        sampleValue: 'Vaqtincha ishsiz',
      },
      {
        tag: '{{citizen.marital_status}}',
        rawKey: 'citizen.marital_status',
        label: 'Oilaviy ahvoli',
        category: 'citizen',
        sampleValue: 'Oilaliman',
      },
      {
        tag: '{{citizen.education}}',
        rawKey: 'citizen.education',
        label: 'Ma’lumoti',
        category: 'citizen',
        sampleValue: 'Oliy',
      },
      {
        tag: '{{citizen.criminal_record}}',
        rawKey: 'citizen.criminal_record',
        label: 'Sudlanganligi',
        category: 'citizen',
        sampleValue: 'Sudlanmaganman',
      },
    ],
  },
  {
    id: 'app',
    label: 'Ariza va Hodisa',
    iconName: 'FileText',
    items: [
      {
        tag: '{{app.number}}',
        rawKey: 'app.number',
        label: 'Ariza qayd raqami',
        category: 'app',
        sampleValue: '2026-00451',
      },
      {
        tag: '{{app.created_date}}',
        rawKey: 'app.created_date',
        label: 'Ariza sanasi',
        category: 'app',
        sampleValue: '«09» noyabr 2026 yil',
      },
      {
        tag: '{{app.crime_article}}',
        rawKey: 'app.crime_article',
        label: 'Jinoyat moddasi',
        category: 'app',
        sampleValue: '168-modda 3-qismi (Firibgarlik)',
      },
      {
        tag: '{{app.district}}',
        rawKey: 'app.district',
        label: 'Ariza tuman bo‘limi',
        category: 'app',
        sampleValue: 'Qarshi tumani',
      },
      {
        tag: '{{app.stolen_amount}}',
        rawKey: 'app.stolen_amount',
        label: 'Yetkazilgan zarar (raqamda)',
        category: 'app',
        sampleValue: '5 000 000',
      },
      {
        tag: '{{app.stolen_amount_words}}',
        rawKey: 'app.stolen_amount_words',
        label: 'Yetkazilgan zarar (so‘z bilan)',
        category: 'app',
        sampleValue: 'besh million so‘m',
      },
      {
        tag: '{{app.description}}',
        rawKey: 'app.description',
        label: 'Ariza qisqacha mazmuni / bayoni',
        category: 'app',
        sampleValue: 'Telegram orqali noma’lum shaxs tomonidan pul yechib olinganligi holati',
      },
    ],
  },
  {
    id: 'victim_card',
    label: 'Jabrlanuvchi Kartasi',
    iconName: 'CreditCard',
    items: [
      {
        tag: '{{victim_card.number}}',
        rawKey: 'victim_card.number',
        label: 'Karta raqami (To‘liq 16 ta)',
        category: 'victim_card',
        sampleValue: '8600 1234 5678 9012',
      },
      {
        tag: '{{victim_card.masked_number}}',
        rawKey: 'victim_card.masked_number',
        label: 'Karta raqami (Yashiringan)',
        category: 'victim_card',
        sampleValue: '8600 **** **** 9012',
      },
      {
        tag: '{{victim_card.holder}}',
        rawKey: 'victim_card.holder',
        label: 'Karta egasi F.I.Sh',
        category: 'victim_card',
        sampleValue: 'SANJAR ERGASHEV',
      },
      {
        tag: '{{victim_card.bank}}',
        rawKey: 'victim_card.bank',
        label: 'Karta banki',
        category: 'victim_card',
        sampleValue: 'O‘zmilliybank',
      },
    ],
  },
  {
    id: 'fraud_card',
    label: 'Firibgar / Tranzit Karta',
    iconName: 'ShieldAlert',
    items: [
      {
        tag: '{{fraud_card.number}}',
        rawKey: 'fraud_card.number',
        label: 'Firibgar karta raqami',
        category: 'fraud_card',
        sampleValue: '9860 9988 7766 5544',
      },
      {
        tag: '{{fraud_card.holder}}',
        rawKey: 'fraud_card.holder',
        label: 'Firibgar karta egasi',
        category: 'fraud_card',
        sampleValue: 'ALIEV VALI',
      },
      {
        tag: '{{fraud_card.bank}}',
        rawKey: 'fraud_card.bank',
        label: 'Karta banki',
        category: 'fraud_card',
        sampleValue: 'Anorbank',
      },
    ],
  },
  {
    id: 'transfers',
    label: 'O‘tkazmalar (Jadval / Loop)',
    iconName: 'ArrowRightLeft',
    items: [
      {
        tag: '{{#transfers}}...{{/transfers}}',
        rawKey: 'transfers',
        label: 'Jadval bloki (Takrorlanuvchi qatorlar)',
        category: 'transfers',
        description: 'Jadval ichiga satr qo‘yib, har bir o‘tkazmani chiqaradi',
        sampleValue: '{{#transfers}}...{{/transfers}}',
      },
      {
        tag: '{{from_card}}',
        rawKey: 'from_card',
        label: 'Qaysi kartadan yechilgan (Jadval ichida)',
        category: 'transfers',
        sampleValue: '8600 1234 5678 9012',
      },
      {
        tag: '{{to_card}}',
        rawKey: 'to_card',
        label: 'Qaysi kartaga tushgan (Jadval ichida)',
        category: 'transfers',
        sampleValue: '9860 9988 7766 5544',
      },
      {
        tag: '{{amount}}',
        rawKey: 'amount',
        label: 'O‘tkazilgan summa (Jadval ichida)',
        category: 'transfers',
        sampleValue: '2 500 000 so‘m',
      },
      {
        tag: '{{transfer_date}}',
        rawKey: 'transfer_date',
        label: 'O‘tkazma sanasi (Jadval ichida)',
        category: 'transfers',
        sampleValue: '01.07.2026',
      },
      {
        tag: '{{provider_name}}',
        rawKey: 'provider_name',
        label: 'To‘lov provayderi (Payme, Click)',
        category: 'transfers',
        sampleValue: 'Payme',
      },
    ],
  },
  {
    id: 'officer',
    label: 'Xodim va Rahbariyat',
    iconName: 'BadgeCheck',
    items: [
      {
        tag: '{{officer.full_name}}',
        rawKey: 'officer.full_name',
        label: 'Xodim F.I.Sh',
        category: 'officer',
        sampleValue: 'Mayor B.Karimov',
      },
      {
        tag: '{{officer.position}}',
        rawKey: 'officer.position',
        label: 'Xodim lavozimi',
        category: 'officer',
        sampleValue: 'Qashqadaryo viloyati IIB TXTB TB KTV katta tergovchisi',
      },
      {
        tag: '{{head.title}}',
        rawKey: 'head.title',
        label: 'Rahbar lavozimi va F.I.Sh (Kimga bo‘limi)',
        category: 'officer',
        sampleValue: 'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga',
      },
    ],
  },
  {
    id: 'system',
    label: 'Umumiy va Sanalar',
    iconName: 'Calendar',
    items: [
      {
        tag: '{{current_date}}',
        rawKey: 'current_date',
        label: 'Bugungi sana (kun.oy.yil)',
        category: 'system',
        sampleValue: '09.11.2026',
      },
      {
        tag: '{{current_date_text}}',
        rawKey: 'current_date_text',
        label: 'Bugungi sana (so‘z bilan)',
        category: 'system',
        sampleValue: '«09» noyabr 2026 yil',
      },
      {
        tag: '{{current_year}}',
        rawKey: 'current_year',
        label: 'Joriy yil',
        category: 'system',
        sampleValue: '2026',
      },
    ],
  },
];

