export interface TemplateFieldConfig {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'date';
  required?: boolean;
  description?: string;
  category?: 'citizen' | 'incident' | 'card' | 'officer';
  defaultValue?: string;
}

export interface DocumentTemplateConfig {
  id: string;
  title: string;
  titleKrill: string;
  defaultDocTitle: string;
  defaultDocTitleKrill: string;
  description: string;
  descriptionKrill: string;
  category: 'Tushuntirish xati' | 'Bayonnoma' | 'Sanksiya' | 'Bo‘sh blank';
  pageCount: number;
  lotinFileName: string;
  krillFileName: string;
  fields: TemplateFieldConfig[];
}

export const OFFICIAL_TEMPLATES: DocumentTemplateConfig[] = [
  {
    id: 'tushuntirish-telegram',
    title: 'Tushuntirish xati (Telegram orqali firibgarlik)',
    titleKrill: 'Тушунтириш хати (Телеграм орқали фирибгарлик)',
    defaultDocTitle: 'Tushuntirish xati',
    defaultDocTitleKrill: 'Тушунтириш хати',
    description:
      'Fuqaroning Telegram akkaunti buzilishi yoki uning nomidan tanishlaridan pul so‘rash holati bo‘yicha 2 betlik tushuntirish xati',
    descriptionKrill:
      'Фуқаронинг Телеграм аккаунти бузилиши ёки унинг номидан танишларидан пул сўраш ҳолати бўйича 2 бетлик тушунтириш хати',
    category: 'Tushuntirish xati',
    pageCount: 2,
    lotinFileName: '1. TUSHUNTIRISH XATI NAMUNA LOTINDA.docx',
    krillFileName: '1. TUSHUNTIRISH XATI NAMUNA KRILLDA.docx',
    fields: [
      // 1. Kimga
      {
        key: 'headTitle',
        label: 'Kimga (Rahbar lavozimi va F.I.Sh.)',
        placeholder: 'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga',
        defaultValue: 'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga',
        category: 'officer',
      },
      // 2. Fuqaro anketa ma'lumotlari
      {
        key: 'citizenFullName',
        label: '1. Fuqaro F.I.Sh. (To‘liq)',
        required: true,
        category: 'citizen',
      },
      {
        key: 'citizenBirthDate',
        label: '2. Tug‘ilgan sanasi va joyi',
        placeholder: '«09» iyun 1978 yil, Qarshi tumani',
        category: 'citizen',
      },
      {
        key: 'maritalStatus',
        label: '3. Oilaviy ahvoli',
        placeholder: 'Oilaliman, 3 nafar farzandim bor',
        defaultValue: 'Oilaliman',
        category: 'citizen',
      },
      {
        key: 'education',
        label: '4. Ma’lumoti',
        placeholder: 'Oliy',
        defaultValue: 'Oliy',
        category: 'citizen',
      },
      {
        key: 'criminalRecord',
        label: '5. Sudlanganligi',
        placeholder: 'sudlanmaganman',
        defaultValue: 'sudlanmaganman',
        category: 'citizen',
      },
      {
        key: 'workplace',
        label: '6. Ish joyi va lavozimi',
        placeholder: 'vaqtincha ishsiz',
        defaultValue: 'vaqtincha ishsiz',
        category: 'citizen',
      },
      { key: 'citizenAddress', label: '7. Yashash manzili', required: true, category: 'citizen' },
      { key: 'citizenPhone', label: 'Telefon raqami (Telegram ulangan)', category: 'citizen' },

      // 3. Voqea tafsilotlari
      {
        key: 'phoneModel',
        label: 'Telefon apparati rusumi',
        placeholder: 'Iphone 16 Pro max',
        category: 'incident',
      },
      {
        key: 'telegramUsagePeriod',
        label: 'Telegramdan foydalanish muddati',
        placeholder: 'taxminan 3-4 yildan buyon',
        defaultValue: 'taxminan 3-4 yildan buyon',
        category: 'incident',
      },
      {
        key: 'compromiseDate',
        label: 'Telegram buzib olingan sana',
        placeholder: '01 iyul',
        defaultValue: '01 iyul',
        category: 'incident',
      },
      {
        key: 'friendInfo',
        label: 'Aldangan tanishining manzili va ismi',
        placeholder: 'Samarqand viloyatida yashovchi Lochin ismli tanishim',
        defaultValue: 'tanishim',
        category: 'incident',
      },
      {
        key: 'stolenAmount',
        label: 'Zarar miqdori (so‘m)',
        placeholder: '2 500 000',
        category: 'incident',
      },

      // 4. Tasdiqlovchi
      { key: 'dateText', label: 'Hujjat sanasi', category: 'officer' },
      {
        key: 'officerName',
        label: 'Tushuntirish xatini olgan xodim',
        required: true,
        category: 'officer',
      },
      {
        key: 'officerPosition',
        label: 'Xodim lavozimi',
        placeholder: 'Qashqadaryo viloyati IIB TXTB TB KTV katta serjanti',
        category: 'officer',
      },
    ],
  },
  {
    id: 'tushuntirish-apk',
    title: 'Tushuntirish xati (Zararli ilova / APK orqali o‘g‘irlik)',
    titleKrill: 'Тушунтириш хати (Зарарли илова / АПК орқали ўғрилик)',
    defaultDocTitle: 'Tushuntirish xati',
    defaultDocTitleKrill: 'Тушунтириш хати',
    description:
      'Soxta reklama yoki zararli APK ilova o‘rnatilgach bank kartasidan pul mablag‘lari yechilishi holati bo‘yicha 2 betlik tushuntirish xati',
    descriptionKrill:
      'Сохта реклама ёки зарарли АПК илова ўрнатилгач банк картасидан пул маблағлари ечилиши ҳолати бўйича 2 бетлик тушунтириш хати',
    category: 'Tushuntirish xati',
    pageCount: 2,
    lotinFileName: '2. TUSHUNTIRISH XATI NAMUNA LOTINDA.docx',
    krillFileName: '2. TUSHUNTIRISH XATI NAMUNA KRILLDA.docx',
    fields: [
      // 1. Kimga
      {
        key: 'headTitle',
        label: 'Kimga (Rahbar lavozimi va F.I.Sh.)',
        placeholder: 'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga',
        defaultValue: 'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga',
        category: 'officer',
      },
      // 2. Fuqaro anketa ma'lumotlari
      {
        key: 'citizenFullName',
        label: '1. Fuqaro F.I.Sh. (To‘liq)',
        required: true,
        category: 'citizen',
      },
      {
        key: 'citizenBirthDate',
        label: '2. Tug‘ilgan sanasi va joyi',
        placeholder: '«20» iyun 2000 yil, Qarshi tumani',
        category: 'citizen',
      },
      {
        key: 'maritalStatus',
        label: '3. Oilaviy ahvoli',
        placeholder: 'Oilaliman',
        defaultValue: 'Oilaliman',
        category: 'citizen',
      },
      {
        key: 'education',
        label: '4. Ma’lumoti',
        placeholder: 'Oliy',
        defaultValue: 'Oliy',
        category: 'citizen',
      },
      {
        key: 'criminalRecord',
        label: '5. Sudlanganligi',
        placeholder: 'sudlanmaganman',
        defaultValue: 'sudlanmaganman',
        category: 'citizen',
      },
      {
        key: 'workplace',
        label: '6. Ish joyi va lavozimi',
        placeholder: 'vaqtincha ishsiz',
        defaultValue: 'vaqtincha ishsiz',
        category: 'citizen',
      },
      { key: 'citizenAddress', label: '7. Yashash manzili', required: true, category: 'citizen' },
      { key: 'citizenPhone', label: 'Telefon raqami', category: 'citizen' },

      // 3. Karta va Zararli dastur tafsilotlari
      {
        key: 'cardOwnerRelation',
        label: 'Karta kimga tegishliligi',
        placeholder: 'o‘zimga tegishli bo‘lgan yoki onam ...ga tegishli bo‘lgan',
        defaultValue: 'o‘zimga tegishli bo‘lgan',
        category: 'card',
      },
      {
        key: 'cardNumber',
        label: 'Bank kartasi raqami',
        placeholder: '9860 0000 0000 0000',
        required: true,
        category: 'card',
      },
      { key: 'cardHolder', label: 'Karta egasi F.I.Sh.', category: 'card' },
      {
        key: 'phoneModel',
        label: 'Telefon apparati rusumi',
        placeholder: 'Poso S40',
        category: 'incident',
      },
      {
        key: 'fakeAppName',
        label: 'Zararli ilova nomi va maqsadi',
        placeholder: '“Road 24” ilovasi',
        defaultValue: '“Road 24” ilovasi',
        category: 'incident',
      },
      {
        key: 'deductionService',
        label: 'Pul yechilgan xizmat nomi',
        placeholder: '“LUMO 5”',
        defaultValue: '“LUMO 5”',
        category: 'incident',
      },
      {
        key: 'deductionTime',
        label: 'Pul yechilgan sana va vaqt',
        placeholder: 'soat 23:14 da',
        category: 'incident',
      },
      {
        key: 'stolenAmount',
        label: 'Yechib olingan summa (so‘m)',
        placeholder: '3 350 000',
        category: 'incident',
      },
      {
        key: 'smsSources',
        label: 'Kelgan SMS kodlar nomlari',
        placeholder: '“sinbad”, “Korzinka”, “Mobiuz_App”',
        defaultValue: '“sinbad”, “Korzinka”, “Mobiuz_App” va “MyTaxi”',
        category: 'incident',
      },

      // 4. Tasdiqlovchi
      { key: 'dateText', label: 'Hujjat sanasi', category: 'officer' },
      {
        key: 'officerName',
        label: 'Tushuntirish xatini olgan xodim',
        required: true,
        category: 'officer',
      },
    ],
  },
  {
    id: 'bayonnoma-1-bet',
    title: 'Murojaatni qabul qilish bayonnomasi (1 betlik)',
    titleKrill: 'Мурожаатни қабул қилиш баённомаси (1 бетлик)',
    defaultDocTitle: 'Bayonnoma',
    defaultDocTitleKrill: 'Баённома',
    description:
      'Narsa yoki buyumni (telefon apparati, plastik karta) ko‘zdan kechirish va olish to‘g‘risida rasmiy 1 betlik bayonnoma',
    descriptionKrill:
      'Нарса ёки буюмни (телефон аппарати, пластик карта) кўздан кечириш ва олиш тўғрисида расмий 1 бетлик баённома',
    category: 'Bayonnoma',
    pageCount: 1,
    lotinFileName: '4. BAYONNOMA 1 BET LOTINDA.docx',
    krillFileName: '4. BAYONNOMA 1 BET.docx',
    fields: [
      {
        key: 'districtName',
        label: 'Tuman / Joy nomi',
        placeholder: 'Qarshi shahri',
        defaultValue: 'Qarshi shahri',
        category: 'incident',
      },
      { key: 'dateText', label: 'Bayonnoma sanasi', category: 'incident' },
      {
        key: 'startTime',
        label: 'Boshlanish vaqti',
        placeholder: '10:00',
        defaultValue: '10:00',
        category: 'incident',
      },
      {
        key: 'endTime',
        label: 'Tugallanish vaqti',
        placeholder: '10:45',
        defaultValue: '10:45',
        category: 'incident',
      },
      { key: 'citizenFullName', label: 'Fuqaro F.I.Sh.', required: true, category: 'citizen' },
      {
        key: 'witness1',
        label: '1-xolis F.I.Sh. va manzili',
        placeholder: '1-xolis: F.I.Sh., manzili, tel',
        category: 'officer',
      },
      {
        key: 'witness2',
        label: '2-xolis F.I.Sh. va manzili',
        placeholder: '2-xolis: F.I.Sh., manzili, tel',
        category: 'officer',
      },
      {
        key: 'inspectionDescription',
        label: 'Ko‘zdan kechirilgan va olingan ashyo bayoni',
        placeholder: 'Fuqaroning telefon apparati, IMEI va bank kartasi ko‘zdan kechirildi...',
        category: 'incident',
      },
      { key: 'officerName', label: 'Bayonnoma tuzgan xodim', required: true, category: 'officer' },
    ],
  },
  {
    id: 'sanksiya-ogrilik',
    title: 'Sanksiya qarori (O‘g‘rilik - JK 169-modda)',
    titleKrill: 'Санкция қарори (Ўғрилик - ЖК 169-модда)',
    defaultDocTitle: 'Sanksiya qarori (O‘g‘rilik)',
    defaultDocTitleKrill: 'Санкция қарори (Ўғрилик)',
    description:
      'Bank sirini tashkil etuvchi ma’lumotlarni to‘plash va hisob raqamlarni muzlatish (HOLD) to‘g‘risida prokuror sanksiyasi qarori (2 betlik)',
    descriptionKrill:
      'Банк сирини ташкил этувчи маълумотларни тўплаш ва ҳисоб рақамларни музлатиш (HOLD) тўғрисида прокурор санкцияси қарори (2 бетлик)',
    category: 'Sanksiya',
    pageCount: 2,
    lotinFileName: 'Sanksiya O‘G‘RILIK NAMUNA LOTINDA.docx',
    krillFileName: 'Санкция ЎҒРИЛИК НАМУНА.docx',
    fields: [
      {
        key: 'prosecutorInfo',
        label: 'Prokuror unvoni va F.I.Sh.',
        placeholder: 'Qarshi shahar prokurori adliya maslahatchisi U.N.Elmurodov',
        category: 'officer',
      },
      {
        key: 'districtName',
        label: 'Shahar / Tuman nomi',
        placeholder: 'Qarshi shahri',
        defaultValue: 'Qarshi shahri',
        category: 'incident',
      },
      { key: 'dateText', label: 'Qaror sanasi', category: 'incident' },
      {
        key: 'officerName',
        label: 'Tergovchi / Tezkor vakil F.I.Sh.',
        required: true,
        category: 'officer',
      },
      {
        key: 'officerPosition',
        label: 'Xodim lavozimi',
        placeholder: 'Kiberjinoyatlarni fosh etish bo‘linmasi O‘MIB tezkor vakili',
        category: 'officer',
      },

      {
        key: 'citizenFullName',
        label: 'Jabrlanuvchi F.I.Sh.',
        required: true,
        category: 'citizen',
      },
      {
        key: 'citizenShortName',
        label: 'Qisqa F.I.Sh. (masalan: S.Haqberdiyev)',
        category: 'citizen',
      },
      { key: 'citizenAddress', label: 'Yashash manzili', category: 'citizen' },

      { key: 'cardNumber', label: 'Jabrlanuvchi karta raqami', required: true, category: 'card' },
      { key: 'cardHolder', label: 'Karta egasi F.I.Sh.', category: 'card' },
      {
        key: 'cardBank',
        label: 'Xizmat ko‘rsatuvchi bank',
        placeholder: 'Aloqabank ATB',
        defaultValue: 'Aloqabank ATB',
        category: 'card',
      },
      {
        key: 'stolenAmount',
        label: 'O‘g‘irlangan summa (so‘m)',
        placeholder: '1 474 650',
        category: 'incident',
      },
    ],
  },
  {
    id: 'sanksiya-firibgarlik',
    title: 'Sanksiya qarori (Firibgarlik - JK 168-modda)',
    titleKrill: 'Санкция қарори (Фирибгарлик - ЖК 168-модда)',
    defaultDocTitle: 'Sanksiya qarori (Firibgarlik)',
    defaultDocTitleKrill: 'Санкция қарори (Фирибгарлик)',
    description:
      'Bank sirini tashkil etuvchi ma’lumotlarni to‘plash, firibgar kartalarini aniqlash va HOLD qilish to‘g‘risida prokuror sanksiyasi qarori (2 betlik)',
    descriptionKrill:
      'Банк сирини ташкил этувчи маълумотларни тўплаш, фирибгар карталарини аниқлаш ва HOLD қилиш тўғрисида прокурор санкцияси қарори (2 бетлик)',
    category: 'Sanksiya',
    pageCount: 2,
    lotinFileName: 'Sanksiya firibgarlik NAMUNA LOTINDA.docx',
    krillFileName: 'Санкция фирибгарлик НАМУНА.docx',
    fields: [
      {
        key: 'prosecutorInfo',
        label: 'Prokuror unvoni va F.I.Sh.',
        placeholder: 'Qarshi tumani prokurori adliya katta maslahatchisi T.J.Murodov',
        category: 'officer',
      },
      {
        key: 'districtName',
        label: 'Tuman / Shahar nomi',
        placeholder: 'Qarshi tumani',
        defaultValue: 'Qarshi tumani',
        category: 'incident',
      },
      { key: 'dateText', label: 'Qaror sanasi', category: 'incident' },
      {
        key: 'officerName',
        label: 'Tergovchi / Tezkor vakil F.I.Sh.',
        required: true,
        category: 'officer',
      },
      {
        key: 'officerPosition',
        label: 'Xodim lavozimi',
        placeholder: 'Kiberjinoyatlarni fosh etish bo‘linmasi O‘MIB tezkor vakili',
        category: 'officer',
      },

      {
        key: 'citizenFullName',
        label: 'Jabrlanuvchi F.I.Sh.',
        required: true,
        category: 'citizen',
      },
      {
        key: 'citizenShortName',
        label: 'Qisqa F.I.Sh. (masalan: Sh.Xusinova)',
        category: 'citizen',
      },
      { key: 'citizenAddress', label: 'Yashash manzili', category: 'citizen' },

      {
        key: 'fraudCardNumber',
        label: 'Firibgar (qabul qiluvchi) karta raqami',
        required: true,
        category: 'card',
      },
      {
        key: 'fraudCardHolder',
        label: 'Firibgar karta egasi',
        placeholder: 'Tolipov Ziyodbek',
        category: 'card',
      },
      {
        key: 'fraudCardBank',
        label: 'Bank nomi',
        placeholder: 'Trastbank ATB',
        defaultValue: 'Trastbank ATB',
        category: 'card',
      },
      {
        key: 'stolenAmount',
        label: 'Zarar miqdori (so‘m)',
        placeholder: '12 600 000',
        category: 'incident',
      },
    ],
  },
];
