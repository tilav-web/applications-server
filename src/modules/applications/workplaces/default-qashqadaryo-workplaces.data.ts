export interface DefaultWorkplaceSeed {
  name: string;
  districtKey: string;
  categoryCode: string;
  occupationNames: string[];
  address?: string;
}

const QASHQADARYO_DISTRICTS: Array<{ key: string; label: string; isCity?: boolean }> = [
  { key: 'qarshi sh', label: 'Qarshi shahar', isCity: true },
  { key: 'shahrisabz sh', label: 'Shahrisabz shahar', isCity: true },
  { key: 'qarshi t', label: 'Qarshi tumani' },
  { key: 'shahrisabz t', label: 'Shahrisabz tumani' },
  { key: 'kitob', label: 'Kitob tumani' },
  { key: "yakkabog'", label: "Yakkabog' tumani" },
  { key: 'qamashi', label: 'Qamashi tumani' },
  { key: 'chiroqchi', label: 'Chiroqchi tumani' },
  { key: "ko'kdala", label: "Ko'kdala tumani" },
  { key: 'koson', label: 'Koson tumani' },
  { key: 'kasbi', label: 'Kasbi tumani' },
  { key: "g'uzor", label: "G'uzor tumani" },
  { key: 'nishon', label: 'Nishon tumani' },
  { key: 'muborak', label: 'Muborak tumani' },
  { key: 'mirishkor', label: 'Mirishkor tumani' },
  { key: 'dehqonobod', label: 'Dehqonobod tumani' },
];

const OTM_OCCUPATIONS = [
  "Oliy ta'lim o'qituvchisi / professor",
  'Talaba (OTM)',
  "Ta'lim muassasasi rahbari / xodimi",
];

const LITSEY_TEXNIKUM_OCCUPATIONS = [
  "Litsey / texnikum / kollej o'quvchisi",
  "O'quv markazi o'qituvchisi / repetitor",
  "Ta'lim muassasasi rahbari / xodimi",
];

const MAKTAB_OCCUPATIONS = [
  "Maktab o'qituvchisi",
  "Maktab o'quvchisi",
  "Ta'lim muassasasi rahbari / xodimi",
];

const BOGCHA_OCCUPATIONS = ["Bog'cha tarbiyachisi", "Ta'lim muassasasi rahbari / xodimi"];

const TIBBIYOT_OCCUPATIONS = [
  'Shifokor (vrach)',
  'Hamshira / feldsher',
  'Kichik tibbiy xodim / laborant',
  'Stomatolog',
];

const BANK_OCCUPATIONS = ['Bank xodimi', 'Buxgalter / auditor', 'Iqtisodchi / moliyachi'];

const NEFT_GAZ_OCCUPATIONS = [
  'Neft-gaz sohasi xodimi',
  'Zavod / fabrika ishchisi',
  'Muhandis / texnolog',
];

const ENERGETIKA_OCCUPATIONS = [
  'Energetika / elektr tarmoqlari xodimi',
  'Muhandis / texnolog',
  'Elektrik / santexnik / payvandchi',
];

const SANOAT_OCCUPATIONS = [
  'Zavod / fabrika ishchisi',
  'Muhandis / texnolog',
  'Tikuvchilik / yengil sanoat ishchisi',
];

const HOKIMIYAT_OCCUPATIONS = ['Hokimiyat xodimi', 'Boshqa davlat xizmatchisi'];

const DAVLAT_IDORA_OCCUPATIONS = [
  'Vazirlik / davlat idorasi xodimi',
  'Soliq / bojxona / kadastr xodimi',
  'Davlat xizmatlari markazi xodimi',
  'Boshqa davlat xizmatchisi',
];

const HUQUQ_OCCUPATIONS = [
  'Huquq-tartibot organlari xodimi',
  'Sud / prokuratura / adliya xodimi',
  'Harbiy xizmatchi (Mudofaa / Milliy gvardiya)',
  'Favqulodda vaziyatlar xodimi (FVV)',
];

const IT_TELEKOM_OCCUPATIONS = [
  'Dasturchi / IT mutaxassisi',
  'Aloqa va telekommunikatsiya xodimi',
  'Dizayner / SMM / marketolog',
];

const TRANSPORT_OCCUPATIONS = [
  "Temir yo'l / aviatsiya xodimi",
  'Yuk mashinasi / avtobus haydovchisi',
  'Taksi haydovchisi',
];

const SAVDO_BOZOR_OCCUPATIONS = [
  "Do'kon / bozor sotuvchisi",
  'Yakka tartibdagi tadbirkor (YaTT)',
  'Kassir / omborchi',
  'Savdo agenti / menejer',
];

function buildDefaultQashqadaryoWorkplaces(): DefaultWorkplaceSeed[] {
  const list: DefaultWorkplaceSeed[] = [];

  // =========================================================================
  // 1. OLIY TA'LIM MUASSASALARI (DAVLAT VA NODAVLAT UNIVERSITETLAR)
  // =========================================================================
  const universities: Array<{ name: string; districtKey: string }> = [
    { name: 'Qarshi davlat universiteti', districtKey: 'qarshi sh' },
    { name: 'Qarshi davlat texnika universiteti', districtKey: 'qarshi sh' },
    {
      name: 'Qarshi davlat texnika universiteti Shahrisabz filiali',
      districtKey: 'shahrisabz sh',
    },
    { name: 'Shahrisabz davlat pedagogika instituti', districtKey: 'shahrisabz sh' },
    {
      name: "Toshkent irrigatsiya va qishloq xo'jaligini mexanizatsiyalash muhandislari instituti (TIQXMMI) Qarshi filiali",
      districtKey: 'qarshi sh',
    },
    { name: 'Qarshi xalqaro universiteti (KIU)', districtKey: 'qarshi sh' },
    { name: 'Xalqaro innovatsion universitet', districtKey: 'qarshi sh' },
    { name: 'Iqtisodiyot va pedagogika universiteti', districtKey: 'qarshi sh' },
    { name: 'Turon universiteti', districtKey: 'qarshi sh' },
    { name: 'Axborot texnologiyalari va menejment universiteti', districtKey: 'qarshi sh' },
    { name: 'Osiyo texnologiyalar universiteti', districtKey: 'qarshi sh' },
  ];
  for (const u of universities) {
    list.push({
      name: u.name,
      districtKey: u.districtKey,
      categoryCode: 'TALIM_FAN',
      occupationNames: OTM_OCCUPATIONS,
    });
  }

  // =========================================================================
  // 2. AKADEMIK LITSEYLAR VA TEXNIKUMLAR
  // =========================================================================
  const litseysAndTexnikums: Array<{ name: string; districtKey: string }> = [
    { name: 'Qarshi davlat universiteti akademik litseyi', districtKey: 'qarshi sh' },
    {
      name: 'Qarshi davlat texnika universiteti "Nuriston" akademik litseyi',
      districtKey: 'qarshi sh',
    },
    {
      name: 'Qarshi davlat texnika universiteti 2-son akademik litseyi',
      districtKey: 'qarshi sh',
    },
    { name: 'TIQXMMI Qarshi filiali akademik litseyi', districtKey: 'qarshi t' },
    { name: 'Shahrisabz davlat pedagogika instituti akademik litseyi', districtKey: 'kitob' },
    {
      name: 'Qarshi Abu Ali ibn Sino nomidagi Jamoat salomatligi texnikumi',
      districtKey: 'qarshi sh',
    },
    { name: 'Qarshi shahar 1-son texnikumi', districtKey: 'qarshi sh' },
    { name: 'Qarshi shahar 2-son texnikumi', districtKey: 'qarshi sh' },
    { name: 'Qarshi shahar 3-son texnikumi', districtKey: 'qarshi sh' },
    { name: 'Shahrisabz shahar 1-son texnikumi', districtKey: 'shahrisabz sh' },
    { name: 'Shahrisabz turizm va madaniy meros texnikumi', districtKey: 'shahrisabz sh' },
    { name: 'Kitob tumani 1-son texnikumi', districtKey: 'kitob' },
    { name: 'Koson tumani 1-son texnikumi', districtKey: 'koson' },
    { name: "G'uzor tumani 1-son texnikumi", districtKey: "g'uzor" },
    { name: "Yakkabog' tumani 1-son texnikumi", districtKey: "yakkabog'" },
    { name: 'Chiroqchi tumani 1-son texnikumi', districtKey: 'chiroqchi' },
    { name: 'Qamashi tumani 1-son texnikumi', districtKey: 'qamashi' },
    { name: 'Muborak tumani 1-son texnikumi', districtKey: 'muborak' },
    { name: 'Kasbi tumani 1-son texnikumi', districtKey: 'kasbi' },
    { name: 'Nishon tumani 1-son texnikumi', districtKey: 'nishon' },
    { name: 'Dehqonobod tumani 1-son texnikumi', districtKey: 'dehqonobod' },
    { name: 'Mirishkor tumani 1-son texnikumi', districtKey: 'mirishkor' },
  ];
  for (const lt of litseysAndTexnikums) {
    list.push({
      name: lt.name,
      districtKey: lt.districtKey,
      categoryCode: 'TALIM_FAN',
      occupationNames: LITSEY_TEXNIKUM_OCCUPATIONS,
    });
  }

  // =========================================================================
  // 3. MAKTABLAR (PREZIDENT, IJOD, IXTISOSLASHTIRILGAN VA UMUMTA'LIM)
  // =========================================================================
  list.push(
    {
      name: 'Qarshi shahridagi Prezident maktabi',
      districtKey: 'qarshi sh',
      categoryCode: 'TALIM_FAN',
      occupationNames: MAKTAB_OCCUPATIONS,
    },
    {
      name: 'Abdulla Oripov nomidagi ijod maktabi',
      districtKey: 'qarshi sh',
      categoryCode: 'TALIM_FAN',
      occupationNames: MAKTAB_OCCUPATIONS,
    },
    {
      name: 'Qarshi shahar 1-son ixtisoslashtirilgan maktab-internati',
      districtKey: 'qarshi sh',
      categoryCode: 'TALIM_FAN',
      occupationNames: MAKTAB_OCCUPATIONS,
    },
  );

  for (const d of QASHQADARYO_DISTRICTS) {
    const schoolCount = d.key === 'qarshi sh' ? 15 : d.key === 'shahrisabz sh' ? 8 : 5;
    for (let num = 1; num <= schoolCount; num++) {
      list.push({
        name: `${d.label} ${num}-son umumiy o'rta ta'lim maktabi`,
        districtKey: d.key,
        categoryCode: 'TALIM_FAN',
        occupationNames: MAKTAB_OCCUPATIONS,
      });
    }
    if (!d.isCity) {
      list.push({
        name: `${d.label} ixtisoslashtirilgan maktabi`,
        districtKey: d.key,
        categoryCode: 'TALIM_FAN',
        occupationNames: MAKTAB_OCCUPATIONS,
      });
    }
  }

  // =========================================================================
  // 4. MAKTABGACHA TA'LIM TASHKILOTLARI (DMTT / BOG'CHALAR)
  // =========================================================================
  for (const d of QASHQADARYO_DISTRICTS) {
    const dmttCount = d.key === 'qarshi sh' ? 5 : 2;
    for (let num = 1; num <= dmttCount; num++) {
      list.push({
        name: `${d.label} ${num}-son davlat maktabgacha ta'lim tashkiloti (DMTT)`,
        districtKey: d.key,
        categoryCode: 'TALIM_FAN',
        occupationNames: BOGCHA_OCCUPATIONS,
      });
    }
  }

  // =========================================================================
  // 5. TIBBIYOT MUASSASALARI (SHIFOXONA, MARKAZ, POLIKLINIKALAR)
  // =========================================================================
  const regionalHospitals: Array<{ name: string; districtKey: string }> = [
    { name: "Qashqadaryo viloyat ko'p tarmoqli tibbiyot markazi", districtKey: 'qarshi sh' },
    {
      name: "Qashqadaryo viloyat bolalar ko'p tarmoqli tibbiyot markazi",
      districtKey: 'qarshi sh',
    },
    {
      name: 'Respublika shoshilinch tibbiy yordam ilmiy markazi Qashqadaryo filiali',
      districtKey: 'qarshi sh',
    },
    { name: 'Qashqadaryo viloyat perinatal markazi', districtKey: 'qarshi sh' },
    { name: 'Qashqadaryo viloyat kardiologiya markazi', districtKey: 'qarshi sh' },
    { name: 'Qashqadaryo viloyat onkologiya markazi', districtKey: 'qarshi sh' },
    { name: 'Qashqadaryo viloyat stomatologiya poliklinikasi', districtKey: 'qarshi sh' },
    { name: "Sho'rtan gaz-kimyo majmuasi tibbiy-sanitariya qismi", districtKey: "g'uzor" },
  ];
  for (const h of regionalHospitals) {
    list.push({
      name: h.name,
      districtKey: h.districtKey,
      categoryCode: 'TIBBIYOT',
      occupationNames: TIBBIYOT_OCCUPATIONS,
    });
  }
  for (const d of QASHQADARYO_DISTRICTS) {
    list.push({
      name: `${d.label} tibbiyot birlashmasi (markaziy shifoxona)`,
      districtKey: d.key,
      categoryCode: 'TIBBIYOT',
      occupationNames: TIBBIYOT_OCCUPATIONS,
    });
  }

  // =========================================================================
  // 6. NEFT-GAZ, ENERGETIKA VA YIRIK SANOAT KORXONALARI
  // =========================================================================
  const neftGaz: Array<{ name: string; districtKey: string }> = [
    { name: '"Uzbekistan GTL" MChJ', districtKey: "g'uzor" },
    { name: '"Sho\'rtan gaz-kimyo majmuasi" MChJ', districtKey: "g'uzor" },
    { name: '"Sho\'rtan neft va gaz qazib chiqarish boshqarmasi"', districtKey: "g'uzor" },
    { name: '"Muborak gazni qayta ishlash zavodi" MChJ', districtKey: 'muborak' },
    { name: '"Muborak neft va gaz qazib chiqarish boshqarmasi"', districtKey: 'muborak' },
    { name: '"Qarshi neft bazasi" MChJ', districtKey: 'qarshi sh' },
    { name: '"Hududgaz Qashqadaryo" gaz ta\'minoti filiali', districtKey: 'qarshi sh' },
  ];
  for (const ng of neftGaz) {
    list.push({
      name: ng.name,
      districtKey: ng.districtKey,
      categoryCode: 'SANOAT_ENERGETIKA',
      occupationNames: NEFT_GAZ_OCCUPATIONS,
    });
  }

  const energetika: Array<{ name: string; districtKey: string }> = [
    { name: '"Tolimarjon IES" AJ', districtKey: 'nishon' },
    {
      name: '"Qashqadaryo hududiy elektr tarmoqlari korxonasi" AJ',
      districtKey: 'qarshi sh',
    },
    { name: '"Qashqadaryo suv ta\'minoti" AJ', districtKey: 'qarshi sh' },
  ];
  for (const en of energetika) {
    list.push({
      name: en.name,
      districtKey: en.districtKey,
      categoryCode: 'SANOAT_ENERGETIKA',
      occupationNames: ENERGETIKA_OCCUPATIONS,
    });
  }

  const sanoat: Array<{ name: string; districtKey: string }> = [
    { name: '"Dehqonobod kaliy zavodi" AJ', districtKey: 'dehqonobod' },
    { name: '"Qarshi tekstil" MChJ', districtKey: 'qarshi sh' },
    { name: '"Shahrisabz tekstil" MChJ', districtKey: 'shahrisabz sh' },
    { name: '"Kitob ip-yigiruv" MChJ', districtKey: 'kitob' },
  ];
  for (const sn of sanoat) {
    list.push({
      name: sn.name,
      districtKey: sn.districtKey,
      categoryCode: 'SANOAT_ENERGETIKA',
      occupationNames: SANOAT_OCCUPATIONS,
    });
  }

  // =========================================================================
  // 7. BANKLAR QASHQADARYO FILIALLARI
  // =========================================================================
  const bankBranches = [
    'Markaziy bank Qashqadaryo viloyat bosh boshqarmasi',
    'Xalq Banki Qashqadaryo viloyat filiali',
    'Agrobank Qashqadaryo viloyat boshqarmasi',
    'Milliy Bank (NBU) Qashqadaryo viloyat filiali',
    "O'zsanoatqurilishbank (SQB) Qashqadaryo mintaqaviy filiali",
    'Ipoteka Bank Qashqadaryo viloyat filiali',
    'Asakabank Qashqadaryo viloyat filiali',
    'Mikrokreditbank Qashqadaryo viloyat filiali',
    'Biznesni Rivojlantirish Banki (BRB) Qashqadaryo filiali',
    'Aloqabank Qashqadaryo viloyat filiali',
    'Kapitalbank Qarshi filiali',
    'Hamkorbank Qashqadaryo viloyat filiali',
    "Ipak Yo'li Banki Qashqadaryo filiali",
    'Trastbank Qarshi filiali',
    'InFinBank Qarshi filiali',
    'Anorbank Qarshi ofisi',
    'TBC Bank Qarshi ofisi',
    'Uzum Bank Qarshi ofisi',
  ];
  for (const bName of bankBranches) {
    list.push({
      name: bName,
      districtKey: 'qarshi sh',
      categoryCode: 'BANK_MOLIYA',
      occupationNames: BANK_OCCUPATIONS,
    });
  }

  // =========================================================================
  // 8. DAVLAT BOSHQARUVI VA HOKIMLIKLAR
  // =========================================================================
  list.push({
    name: 'Qashqadaryo viloyati hokimligi',
    districtKey: 'qarshi sh',
    categoryCode: 'DAVLAT_XIZMATI',
    occupationNames: HOKIMIYAT_OCCUPATIONS,
  });
  for (const d of QASHQADARYO_DISTRICTS) {
    list.push({
      name: `${d.label} hokimligi`,
      districtKey: d.key,
      categoryCode: 'DAVLAT_XIZMATI',
      occupationNames: HOKIMIYAT_OCCUPATIONS,
    });
  }
  const stateBodies = [
    'Qashqadaryo viloyat soliq boshqarmasi',
    'Qashqadaryo viloyat bojxona boshqarmasi',
    'Qashqadaryo viloyat kadastr boshqarmasi',
    'Qashqadaryo viloyat adliya boshqarmasi',
    'Qarshi shahar Davlat xizmatlari markazi (DXM)',
    'Shahrisabz shahar Davlat xizmatlari markazi (DXM)',
  ];
  for (const sb of stateBodies) {
    list.push({
      name: sb,
      districtKey: sb.includes('Shahrisabz') ? 'shahrisabz sh' : 'qarshi sh',
      categoryCode: 'DAVLAT_XIZMATI',
      occupationNames: DAVLAT_IDORA_OCCUPATIONS,
    });
  }

  // =========================================================================
  // 9. HUQUQ-TARTIBOT, SUD VA HARBIY ORGANLAR
  // =========================================================================
  const lawBodies = [
    'Qashqadaryo viloyati Ichki ishlar boshqarmasi (IIB)',
    'Qashqadaryo viloyati Prokuraturasi',
    'Qashqadaryo viloyat sudi',
    'Qashqadaryo viloyati Favqulodda vaziyatlar boshqarmasi (FVB)',
    'Milliy gvardiya Qashqadaryo viloyati boshqarmasi',
    "Janubi-g'arbiy maxsus harbiy okrug",
  ];
  for (const lb of lawBodies) {
    list.push({
      name: lb,
      districtKey: 'qarshi sh',
      categoryCode: 'HUQUQ_TARTIBOT',
      occupationNames: HUQUQ_OCCUPATIONS,
    });
  }

  // =========================================================================
  // 10. IT, TELEKOMMUNIKATSIYA, TRANSPORT VA SAVDO MARKAZLARI
  // =========================================================================
  const itTelecom = [
    'IT Park Qashqadaryo filiali',
    '"O\'zbektelekom" AK Qashqadaryo filiali',
    'Beeline Uzbekistan Qarshi filiali',
    'Ucell Qarshi filiali',
    'Mobiuz Qarshi filiali',
  ];
  for (const it of itTelecom) {
    list.push({
      name: it,
      districtKey: 'qarshi sh',
      categoryCode: 'IT_MEDIA',
      occupationNames: IT_TELEKOM_OCCUPATIONS,
    });
  }

  const transport = [
    '"Qarshi mintaqaviy temir yo\'l uzeli" UK',
    'Qarshi xalqaro aeroporti',
    'Qarshi shahar avtovokzali',
  ];
  for (const tr of transport) {
    list.push({
      name: tr,
      districtKey: 'qarshi sh',
      categoryCode: 'TRANSPORT_LOGISTIKA',
      occupationNames: TRANSPORT_OCCUPATIONS,
    });
  }

  const markets: Array<{ name: string; districtKey: string }> = [
    { name: 'Qarshi markaziy dehqon bozori', districtKey: 'qarshi sh' },
    { name: "Yerqo'rg'on dehqon bozori", districtKey: 'qarshi sh' },
    { name: 'Qarshi buyum bozori', districtKey: 'qarshi sh' },
    { name: 'Shahrisabz markaziy dehqon bozori', districtKey: 'shahrisabz sh' },
    { name: 'Koson markaziy dehqon bozori', districtKey: 'koson' },
    { name: 'Kitob markaziy dehqon bozori', districtKey: 'kitob' },
    { name: 'Chiroqchi markaziy dehqon bozori', districtKey: 'chiroqchi' },
    { name: "Yakkabog' markaziy dehqon bozori", districtKey: "yakkabog'" },
  ];
  for (const mk of markets) {
    list.push({
      name: mk.name,
      districtKey: mk.districtKey,
      categoryCode: 'TADBIRKORLIK_SAVDO',
      occupationNames: SAVDO_BOZOR_OCCUPATIONS,
    });
  }

  return list;
}

export const DEFAULT_QASHQADARYO_WORKPLACES: DefaultWorkplaceSeed[] =
  buildDefaultQashqadaryoWorkplaces();
