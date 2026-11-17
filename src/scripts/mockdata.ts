import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { DataSource, ILike } from 'typeorm';

import { AppModule } from '../app.module';
import { CrimeGravity } from '../common/enums/crime-gravity.enum';
import { CustomFieldType } from '../common/enums/custom-field-type.enum';
import { TransferStatus } from '../common/enums/transfer-status.enum';
import { Application, SuspectTreeNode } from '../modules/applications/application.entity';
import { Citizen } from '../modules/applications/citizens/citizen.entity';
import { Crime } from '../modules/applications/crimes/crime.entity';
import { CrimeMethod } from '../modules/applications/crimes/methods/crime-method.entity';
import { ApplicationCustomField } from '../modules/applications/custom-fields/application-custom-field.entity';
import { DecisionType } from '../modules/applications/decision-types/decision-type.entity';
import { DepartmentService } from '../modules/applications/department-services/department-service.entity';
import { District } from '../modules/applications/districts/district.entity';
import { Mahalla } from '../modules/applications/mahallas/mahalla.entity';
import { Occupation } from '../modules/applications/occupations/occupation.entity';
import { OccupationCategory } from '../modules/applications/occupations/occupation-category.entity';
import { RejectionReason } from '../modules/applications/rejection-reasons/rejection-reason.entity';
import { ApplicationSource } from '../modules/applications/sources/application-source.entity';
import { ApplicationStatus as ApplicationStatusEntity } from '../modules/applications/statuses/application-status.entity';
import { Bank } from '../modules/applications/transfers/banks/bank.entity';
import { Card } from '../modules/applications/transfers/cards/card.entity';
import { PaymentProvider } from '../modules/applications/transfers/payment_providers/payment_provider.entity';
import { Transfer } from '../modules/applications/transfers/transfer.entity';
import { DigitalIdentifierEntity } from '../modules/intelligence/entities/digital-identifier.entity';
import { EntityApplicationLink } from '../modules/intelligence/entities/entity-application-link.entity';
import { PhoneEntity } from '../modules/intelligence/entities/phone.entity';
import { IntelligenceSyncService } from '../modules/intelligence/intelligence-sync.service';

const REGISTRY_TABLE = '_mock_data_registry';

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function createRng(seed = 20261117) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MALE_FIRST_NAMES = [
  'Sardor',
  'Jasurbek',
  'Bekzod',
  'Otabek',
  'Sanjar',
  'Ulug‘bek',
  'Dilshod',
  'azizbek',
  'Shohruh',
  'Bobur',
  'Farrux',
  'Jamshid',
  'Alisher',
  'Nodirbek',
  'Doston',
  'Sherzod',
  'Xurshid',
  'Abror',
  ' Zafar',
  'Mirjalol',
  ' Islombek',
  ' Eldor',
  'Akmal',
  'Rustam',
  'Bahodir',
  'Anvar',
  ' Umidjon',
  ' Doniyor',
  'Suhrob',
  'Murodjon',
].map((s) => s.trim().replace(/^[a-z]/, (c) => c.toUpperCase()));

const FEMALE_FIRST_NAMES = [
  'Dilnoza',
  'Gulchehra',
  'Mohira',
  'Shahnoza',
  'Sevara',
  'Madina',
  'Feruza',
  'Zarina',
  'Nargiza',
  'Maftuna',
  'Nilufar',
  'Nigora',
  'Zilola',
  'Dildora',
  'Barno',
  'Umida',
  'Durdona',
  'Kamola',
  'Malika',
  ' Munisa',
  'Rayhon',
  'Xurshida',
  'Ozoda',
  'Gavhar',
].map((s) => s.trim());

const LAST_NAME_ROOTS = [
  'Abdurahmon',
  'Qodir',
  'Tursun',
  'Nazar',
  'Xoliq',
  'Ergash',
  'Yo‘ldosh',
  'Karim',
  'Rahim',
  'Sattor',
  'Berdiy',
  ' Toshmat',
  ' Boymurod',
  ' Normurod',
  ' Jo‘ray',
  ' Salom',
  'Xudoyberdiy',
  'Olim',
  'Hasanov',
  ' Qurbon',
  ' Esanov',
  ' Mamatqul',
  ' Shodmon',
  ' Allayar',
  ' Safar',
  ' Ro‘ziy',
  ' Bozor',
  ' Hamroy',
  ' Chori',
  ' Ochil',
  ' Rasul',
  ' Sobir',
].map((s) => s.trim().replace(/ov$/i, ''));

const PATRONYMIC_ROOTS = [
  'Rustam',
  'Bahodir',
  'Olimjon',
  'Shavkat',
  'Erkin',
  'Ulug‘bek',
  'Baxtiyor',
  'Abduvali',
  ' To‘lqin',
  ' Xurram',
  ' Mamat',
  ' Normat',
  ' Ilhom',
  ' Shuhrat',
  ' Sobir',
  ' Odil',
  ' Mahmud',
  ' Qahramon',
  ' Sulton',
  ' Botir',
].map((s) => s.trim());

const STREET_NAMES = [
  'Mustaqillik ko‘chasi',
  'Amir Temur shoh ko‘chasi',
  'Nasaf ko‘chasi',
  'Alisher Navoiy ko‘chasi',
  'O‘zbekiston ovozi ko‘chasi',
  'Buyuk Ipak yo‘li ko‘chasi',
  'Jayxun ko‘chasi',
  'Bahoriston ko‘chasi',
  'Paxtazor mitti tumani',
  'Yangi hayot ko‘chasi',
  'Ziyokorlar ko‘chasi',
  'Shodlik ko‘chasi',
  'Guliston ko‘chasi',
  'Do‘stlik ko‘chasi',
  'Mirzo Ulug‘bek ko‘chasi',
];

const BANK_DEFS: Array<{ name: string; mfo: string; bins: string[] }> = [
  { name: 'Xalq Banki', mfo: '00401', bins: ['860006', '986006'] },
  { name: 'Agrobank', mfo: '00394', bins: ['860004', '986004'] },
  { name: 'Ipoteka Bank', mfo: '00075', bins: ['860031', '986031'] },
  { name: 'Milliy Bank (NBU)', mfo: '00450', bins: ['860012', '986012'] },
  { name: 'Kapitalbank', mfo: '00974', bins: ['860049', '986008'] },
  { name: 'Hamkorbank', mfo: '00083', bins: ['860014', '986014'] },
  { name: 'Anorbank', mfo: '01183', bins: ['860048', '986016'] },
  { name: 'TBC Bank', mfo: '01180', bins: ['986024', '530011'] },
  { name: 'Uzum Bank', mfo: '01197', bins: ['986060', '986035'] },
  { name: 'Ipak Yo‘li Banki', mfo: '00421', bins: ['986003', '860020'] },
  { name: 'O‘zsanoatqurilishbank', mfo: '00440', bins: ['860002', '986002'] },
];

const PROVIDER_NAMES = [
  'Click',
  'Payme',
  'Uzum Bank',
  'Anorbank',
  'TBC',
  'Paynet',
  'Xazna',
  'Beepul',
];

const CRIME_ARTICLES: Array<{ article: string; title: string; gravity: CrimeGravity }> = [
  {
    article: 'JK 168-modda 3-qism "g" bandi',
    title: 'Axborot tizimidan foydalanib sodir etilgan firibgarlik',
    gravity: CrimeGravity.ORTA_OGIR,
  },
  {
    article: 'JK 169-modda 3-qism "b" bandi',
    title: 'Kompyuter tizimiga ruxsatsiz kirib sodir etilgan o‘g‘rilik',
    gravity: CrimeGravity.OGIR,
  },
  {
    article: 'JK 168-modda 2-qism "a" bandi',
    title: 'Ancha miqdorda firibgarlik',
    gravity: CrimeGravity.UNCHA_OGIR_BOLMAGAN,
  },
  {
    article: 'JK 168-modda 4-qism "a" bandi',
    title: 'Juda ko‘p miqdorda kiberfiribgarlik',
    gravity: CrimeGravity.OGIR,
  },
];

interface FraudScenario {
  methodCode: string;
  suspectPhones: string[];
  suspectTelegrams: string[];
  suspectInstagrams?: string[];
  suspectUrls?: string[];
  suspectIps?: string[];
  minAmount: number;
  maxAmount: number;
  buildDescription: (ctx: {
    victimName: string;
    districtName: string;
    amountFormatted: string;
    cardLast4: string;
    providerName: string;
    suspectHandle: string;
    dateLabel: string;
  }) => { description: string; officerNotes: string };
}

const SCENARIOS: FraudScenario[] = [
  {
    methodCode: '1',
    suspectPhones: ['+998994418203', '+998937184920'],
    suspectTelegrams: ['@taklifnoma_apk_bot', '@jarima_yhxbb_info'],
    suspectUrls: ['https://my-gov-kompensatsiya.uz/check', 'https://uzpost-yetkazish.site/track'],
    suspectIps: ['185.196.214.88', '91.212.89.142'],
    minAmount: 2_400_000,
    maxAmount: 28_500_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni ${c.districtName}da yashovchi fuqaro ${c.victimName}ning Telegram messenjeriga noma‘lum foydalanuvchi (${c.suspectHandle}) tomonidan "To‘y taklifnomasi.apk" nomli zararli dasturiy fayl yuborilgan. Fuqaro ushbu faylni telefoniga o‘rnatganidan so‘ng, qurilma SMS-xabarnomalari boshqaruvi qo‘lga kiritilib, unga tegishli **** ${c.cardLast4} plastik kartasidan ${c.providerName} ilovasi orqali jami ${c.amountFormatted} so‘m pul mablag‘lari ruxsatsiz yechib olingan.`,
      officerNotes: `Qurilmadan zararli APK namunasi olindi, ${c.providerName} tranzaksiya sessiyasi va IP loglar bo‘yicha so‘rovnoma yuborildi.`,
    }),
  },
  {
    methodCode: '2',
    suspectPhones: ['+998950187744', '+998883921055', '+998974093312'],
    suspectTelegrams: ['@mb_xavfsizlik_uz', '@kiber_nazorat_support'],
    suspectIps: ['45.141.78.209'],
    minAmount: 3_200_000,
    maxAmount: 36_000_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni fuqaro ${c.victimName}ning telefon raqamiga o‘zini Markaziy bank kiberxavfsizlik xizmati mutaxassisi deb tanishtirgan shaxs qo‘ng‘iroq qilib, fuqaroning nomiga onlayn kredit rasmiylashtirilayotganini aytib aldagan. Mablag‘larni "xavfsiz hisob raqamga" o‘tkazish bahonasida SMS tasdiqlash kodini olib, **** ${c.cardLast4} kartasidan ${c.providerName} orqali ${c.amountFormatted} so‘m pulni o‘zlashtirgan.`,
      officerNotes: `SIP-telefoniya shlyuzi orqali kiruvchi qo‘ng‘iroq aniqlangan, qabul qiluvchi dropper karta egasi shaxsiga aniqlik kiritilmoqda.`,
    }),
  },
  {
    methodCode: '3',
    suspectPhones: ['+998908146629', '+998916258034'],
    suspectTelegrams: ['@olx_dostavka_admin', '@arzon_texnika_qarshi'],
    suspectInstagrams: ['@iphone_optom_uzb', '@mebel_chegirma_uz'],
    minAmount: 650_000,
    maxAmount: 9_800_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni fuqaro ${c.victimName} ijtimoiy tarmoqdagi ${c.suspectHandle} sahifasida arzon narxda maishiy texnika va smartfon sotilishi haqidagi e‘lonni ko‘rib, sotuvchi bilan bog‘langan. Sotuvchi tovarni kuryer orqali jo‘natish uchun oldindan to‘lov talab qilib, fuqaroning **** ${c.cardLast4} kartasidan ${c.providerName} orqali ${c.amountFormatted} so‘m o‘tkazdirib olgan va yozishmalarni o‘chirib aloqani uzgan.`,
      officerNotes: `Instagram/Telegram sahifa skrinshotlari va to‘lov cheki arizaga ilova qilindi. Xuddi shu karta boshqa e‘lon arizalarida ham uchragan.`,
    }),
  },
  {
    methodCode: '12',
    suspectPhones: ['+998934829910', '+998991045578'],
    suspectTelegrams: ['@pubg_garant_savdo', '@uc_akkaunt_bozor'],
    minAmount: 450_000,
    maxAmount: 4_200_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni fuqaro ${c.victimName} Telegramdagi ${c.suspectHandle} guruhida yuqori darajali "PUBG Mobile" o‘yin akkauntini sotib olish bo‘yicha kelishib, o‘zining **** ${c.cardLast4} plastik kartasidan ${c.providerName} ilovasi orqali ${c.amountFormatted} so‘m o‘tkazib bergan. Pul tushgach, gumonlanuvchi login-parolni bermasdan fuqaroni qora ro‘yxatga kiritgan.`,
      officerNotes: `Telegram ID va bog‘langan dropper karta bo‘yicha hududlararo bog‘liqlik mavjud.`,
    }),
  },
  {
    methodCode: '4',
    suspectPhones: ['+998977812460', '+998945120987'],
    suspectTelegrams: ['@halol_treyd_invest', '@uz_birja_kapital'],
    suspectInstagrams: ['@halol_sarmoya_uz'],
    suspectUrls: ['https://uz-invest-trade.pro'],
    minAmount: 4_500_000,
    maxAmount: 45_000_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni fuqaro ${c.victimName} Telegramdagi ${c.suspectHandle} kanali orqali qisqa muddatda sarmoyani 4 barobargacha ko‘paytirib berish va‘dasiga ishonib, dastlabki sarmoya va "komissiya solig‘i" sifatida **** ${c.cardLast4} kartasidan ${c.providerName} orqali ${c.amountFormatted} so‘m pul mablag‘larini o‘tkazib berib aldanib qolgan.`,
      officerNotes: `Bir necha bosqichli pul yechish zanjiri aniqlandi; mablag‘lar tranzit kartadan kripto P2P savdosiga yo‘naltirilgan.`,
    }),
  },
  {
    methodCode: '6',
    suspectPhones: ['+998997734102'],
    suspectTelegrams: ['@onlayn_mikroqarz_24', '@kredit_tasdiq_uz'],
    suspectIps: ['194.87.112.54'],
    minAmount: 5_000_000,
    maxAmount: 32_000_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni noma‘lum shaxslar fuqaro ${c.victimName}ning shaxsga doir ma‘lumotlari va mobil banking ilovasiga kirish imkonini qo‘lga kiritib, uning nomiga masofadan onlayn mikroqarz rasmiylashtirgan hamda **** ${c.cardLast4} kartasiga tushgan ${c.amountFormatted} so‘m kredit mablag‘ini ${c.providerName} orqali begona kartaga o‘tkazib yuborgan.`,
      officerNotes: `Bankdan kredit shartnomasi loglari, Face-ID tekshiruv ma‘lumoti va qurilma IMEI/IP rekvizitlari talab qilindi.`,
    }),
  },
  {
    methodCode: '24',
    suspectPhones: ['+998912904418'],
    suspectTelegrams: ['@tg_premium_ovoz_bot'],
    minAmount: 800_000,
    maxAmount: 6_500_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni noma‘lum shaxs fuqaro ${c.victimName}ning yaqin tanishiga tegishli Telegram profilni soxta ovoz berish havolasi (${c.suspectHandle}) orqali egallab olib, uning nomidan shoshilinch shifoxona xarajatlari uchun qarz so‘rab yozgan. Fuqaro ishonib, **** ${c.cardLast4} kartasidan ${c.providerName} orqali ${c.amountFormatted} so‘m o‘tkazib bergan.`,
      officerNotes: `Jabrlanuvchining tanishi bilan suhbat o‘tkazildi, buzilgan akkaunt sessiyalari tekshirildi.`,
    }),
  },
  {
    methodCode: '25',
    suspectPhones: ['+998939051764'],
    suspectTelegrams: ['@moddiy_yordam_uzbot', '@bola_puli_qabul'],
    suspectUrls: ['https://ijtimoiy-yordam-uz.org'],
    minAmount: 1_100_000,
    maxAmount: 11_500_000,
    buildDescription: (c) => ({
      description: `${c.dateLabel} kuni fuqaro ${c.victimName} Telegramdagi ${c.suspectHandle} botida har bir oilaga 1 500 000 so‘mdan davlat kompensatsiyasi berilishi haqidagi yolg‘on xabarga ishonib, soxta saytga **** ${c.cardLast4} karta raqami va SMS kodni kiritgan. Natijada ${c.providerName} orqali hisobidan ${c.amountFormatted} so‘m yechib olingan.`,
      officerNotes: `Fishing domeni bloklash uchun yuborildi, pul tushgan vositachi karta bo‘yicha bank ma‘lumoti olindi.`,
    }),
  },
];

async function ensureRegistryTable(ds: DataSource): Promise<void> {
  await ds.query(`
    CREATE TABLE IF NOT EXISTS ${REGISTRY_TABLE} (
      entity_table varchar(64) NOT NULL,
      entity_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_table, entity_id)
    );
  `);
}

async function registerMockIds(ds: DataSource, entityTable: string, ids: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const chunkSize = 250;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const slice = uniqueIds.slice(i, i + chunkSize);
    const params: string[] = [];
    const placeholders: string[] = [];
    slice.forEach((id, idx) => {
      const p1 = idx * 2 + 1;
      const p2 = idx * 2 + 2;
      placeholders.push(`($${p1}, $${p2}::uuid)`);
      params.push(entityTable, id);
    });
    await ds.query(
      `INSERT INTO ${REGISTRY_TABLE} (entity_table, entity_id) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
  }
}

async function getRegisteredIds(ds: DataSource, entityTable: string): Promise<string[]> {
  const rows: Array<{ entity_id: string }> = await ds.query(
    `SELECT entity_id FROM ${REGISTRY_TABLE} WHERE entity_table = $1`,
    [entityTable],
  );
  return rows.map((r) => r.entity_id);
}

async function cleanMockData(
  ds: DataSource,
  intelligenceSync: IntelligenceSyncService,
  silentIfEmpty = false,
): Promise<void> {
  await ensureRegistryTable(ds);

  const countRes: Array<{ cnt: string }> = await ds.query(
    `SELECT COUNT(*)::text AS cnt FROM ${REGISTRY_TABLE}`,
  );
  const totalTracked = Number(countRes[0]?.cnt || 0);
  if (totalTracked === 0) {
    if (!silentIfEmpty) {
      log('Bazada mock ma‘lumotlar topilmadi (allaqachon toza).');
    }
    return;
  }

  log(`Mock ma‘lumotlarni tozalash boshlandi (${totalTracked} ta belgilangan yozuv)...`);

  const appIds = await getRegisteredIds(ds, 'applications');
  const transferIds = await getRegisteredIds(ds, 'transfers');
  const acfIds = await getRegisteredIds(ds, 'application_custom_fields');
  const cardIds = await getRegisteredIds(ds, 'cards');
  const citizenIds = await getRegisteredIds(ds, 'citizens');
  const phoneIds = await getRegisteredIds(ds, 'phones');
  const identIds = await getRegisteredIds(ds, 'digital_identifiers');
  const linkIds = await getRegisteredIds(ds, 'entity_application_links');

  await ds.transaction(async (manager) => {
    // 1. Intelligence links
    if (appIds.length > 0) {
      await manager.query(
        `DELETE FROM entity_application_links WHERE application_id = ANY($1::uuid[])`,
        [appIds],
      );
    }
    if (linkIds.length > 0) {
      await manager.query(`DELETE FROM entity_application_links WHERE id = ANY($1::uuid[])`, [
        linkIds,
      ]);
    }

    // 2. Application custom fields
    if (appIds.length > 0) {
      await manager.query(
        `DELETE FROM application_custom_fields WHERE application_id = ANY($1::uuid[])`,
        [appIds],
      );
    }
    if (acfIds.length > 0) {
      await manager.query(`DELETE FROM application_custom_fields WHERE id = ANY($1::uuid[])`, [
        acfIds,
      ]);
    }

    // 3. Transfer custom fields & unlink primary transfer_id on mock applications
    if (transferIds.length > 0) {
      await manager.query(
        `DELETE FROM transfer_custom_fields WHERE transfer_id = ANY($1::uuid[])`,
        [transferIds],
      );
    }
    if (appIds.length > 0) {
      await manager.query(
        `UPDATE applications SET transfer_id = NULL, card_id = NULL, citizen_id = NULL WHERE id = ANY($1::uuid[])`,
        [appIds],
      );
    }

    // 4. Transfers (faqat real arizaga biriktirilmagan mock transferlar o'chiriladi)
    if (transferIds.length > 0) {
      await manager.query(
        `DELETE FROM transfers t
         WHERE t.id = ANY($1::uuid[])
           AND (t.application_id IS NULL OR t.application_id = ANY($2::uuid[]))
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.transfer_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM application_custom_fields cf WHERE cf.transfer_id = t.id)`,
        [transferIds, appIds.length > 0 ? appIds : ['00000000-0000-0000-0000-000000000000']],
      );
    }

    // 5. Mock applications
    if (appIds.length > 0) {
      await manager.query(`DELETE FROM applications WHERE id = ANY($1::uuid[])`, [appIds]);
    }

    // 6. Cards (faqat real ariza va real transferlarda ishlatilmaganlari o'chiriladi)
    if (cardIds.length > 0) {
      await manager.query(
        `DELETE FROM cards c
         WHERE c.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.card_id = c.id)
           AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.sender_card_id = c.id OR t.receiver_card_id = c.id OR t.card_id = c.id)
           AND NOT EXISTS (SELECT 1 FROM application_custom_fields cf WHERE cf.card_id = c.id)`,
        [cardIds],
      );
    }

    // 7. Phones & Digital Identifiers (faqat real bog'liqligi yo'qlari o'chiriladi)
    if (phoneIds.length > 0) {
      await manager.query(
        `DELETE FROM phones p
         WHERE p.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM entity_application_links l WHERE l.phone_id = p.id)`,
        [phoneIds],
      );
    }
    if (identIds.length > 0) {
      await manager.query(
        `DELETE FROM digital_identifiers d
         WHERE d.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM entity_application_links l WHERE l.identifier_id = d.id)`,
        [identIds],
      );
    }

    // 8. Citizens (faqat real ariza/karta/telefonda ishlatilmaganlari o'chiriladi)
    if (citizenIds.length > 0) {
      await manager.query(
        `DELETE FROM citizens cz
         WHERE cz.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.citizen_id = cz.id)
           AND NOT EXISTS (SELECT 1 FROM application_custom_fields cf WHERE cf.citizen_id = cz.id)
           AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.citizen_id = cz.id)
           AND NOT EXISTS (SELECT 1 FROM phones p WHERE p.citizen_id = cz.id)`,
        [citizenIds],
      );
    }

    await manager.query(`TRUNCATE TABLE ${REGISTRY_TABLE}`);
  });

  await intelligenceSync.syncAllExistingData();
  log(
    `Tozalash muvaffaqiyatli yakunlandi: ${appIds.length} ta mock ariza va ${transferIds.length} ta mock o‘tkazma o‘chirildi. Real ma‘lumotlar saqlab qolindi!`,
  );
}

async function seedMockData(
  ds: DataSource,
  intelligenceSync: IntelligenceSyncService,
): Promise<void> {
  await ensureRegistryTable(ds);

  // Agar oldingi mock batch mavjud bo'lsa, ustma-ust tushmasligi uchun avval uni tozalaymiz
  await cleanMockData(ds, intelligenceSync, true);

  const rng = createRng(20261117);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const randInt = (min: number, max: number): number => Math.floor(rng() * (max - min + 1)) + min;

  // Mavjud real ID'larning snapshotini olamiz (IntelligenceSync yaratgan yangi yozuvlarni aniq ajratish uchun)
  const prePhoneIds = new Set(
    (await ds.getRepository(PhoneEntity).find({ select: { id: true } })).map((x) => x.id),
  );
  const preIdentIds = new Set(
    (await ds.getRepository(DigitalIdentifierEntity).find({ select: { id: true } })).map(
      (x) => x.id,
    ),
  );
  const preLinkIds = new Set(
    (await ds.getRepository(EntityApplicationLink).find({ select: { id: true } })).map((x) => x.id),
  );

  // 1. Master ma'lumotnomalarni bazadan o'qiymiz (dublikat yaratmaslik qoidasi!)
  const districtRepo = ds.getRepository(District);
  const mahallaRepo = ds.getRepository(Mahalla);
  const bankRepo = ds.getRepository(Bank);
  const providerRepo = ds.getRepository(PaymentProvider);
  const crimeRepo = ds.getRepository(Crime);
  const crimeMethodRepo = ds.getRepository(CrimeMethod);
  const statusRepo = ds.getRepository(ApplicationStatusEntity);
  const occCatRepo = ds.getRepository(OccupationCategory);
  const occRepo = ds.getRepository(Occupation);
  const sourceRepo = ds.getRepository(ApplicationSource);
  const deptServiceRepo = ds.getRepository(DepartmentService);
  const decisionTypeRepo = ds.getRepository(DecisionType);
  const rejectionReasonRepo = ds.getRepository(RejectionReason);

  const citizenRepo = ds.getRepository(Citizen);
  const cardRepo = ds.getRepository(Card);
  const transferRepo = ds.getRepository(Transfer);
  const appRepo = ds.getRepository(Application);
  const acfRepo = ds.getRepository(ApplicationCustomField);

  const districts = await districtRepo.find();
  if (districts.length === 0) {
    throw new Error('Bazada tumanlar topilmadi. Avval serverni ishga tushiring.');
  }

  const allMahallas = await mahallaRepo.find();
  const mahallasByDistrict = new Map<string, Mahalla[]>();
  for (const m of allMahallas) {
    if (!m.district_id) continue;
    const list = mahallasByDistrict.get(m.district_id) ?? [];
    list.push(m);
    mahallasByDistrict.set(m.district_id, list);
  }

  // Banklar (mavjud bo'lsa ulaymiz, yo'q bo'lsa 1 marta yaratamiz)
  const banksWithBins: Array<{ bank: Bank; bins: string[] }> = [];
  for (const bDef of BANK_DEFS) {
    let bank = await bankRepo.findOne({ where: { name: ILike(bDef.name) } });
    if (!bank) {
      bank = await bankRepo.save(bankRepo.create({ name: bDef.name, mfo: bDef.mfo }));
    }
    banksWithBins.push({ bank, bins: bDef.bins });
  }

  // To'lov provayderlari
  const providers: PaymentProvider[] = [];
  for (const pName of PROVIDER_NAMES) {
    let prov = await providerRepo.findOne({ where: { name: ILike(pName) } });
    if (!prov) {
      prov = await providerRepo.save(
        providerRepo.create({ name: pName, code: pName.toLowerCase().replace(/\s+/g, '_') }),
      );
    }
    providers.push(prov);
  }

  // Jinoyat moddalari
  const crimes: Crime[] = [];
  for (const cDef of CRIME_ARTICLES) {
    let crime = await crimeRepo.findOne({ where: { article: ILike(cDef.article) } });
    if (!crime) {
      crime = await crimeRepo.save(
        crimeRepo.create({
          article: cDef.article,
          title: cDef.title,
          gravity: cDef.gravity,
        }),
      );
    }
    if (crime) {
      crimes.push(crime);
    }
  }

  const crimeMethods = await crimeMethodRepo.find({ where: { is_active: true } });
  const methodByCode = new Map<string, CrimeMethod>();
  for (const cm of crimeMethods) {
    if (cm.code) methodByCode.set(cm.code, cm);
  }

  const statuses = await statusRepo.find();
  const statusNew =
    statuses.find((s) => (s.code || '').toUpperCase().includes('YANGI')) || statuses[0] || null;
  const statusProgress =
    statuses.find((s) => (s.code || '').toUpperCase().includes('JARAYONDA')) || statusNew || null;
  const statusResolved =
    statuses.find((s) => (s.code || '').toUpperCase().includes('HAL')) || statusNew || null;
  const statusRejected =
    statuses.find((s) => (s.code || '').toUpperCase().includes('RAD')) || statusNew || null;

  const occCategories = await occCatRepo.find();
  const occupations = await occRepo.find();
  const sources = await sourceRepo.find();
  const deptServices = await deptServiceRepo.find();
  const decisionTypes = await decisionTypeRepo.find();
  const rejectionReasons = await rejectionReasonRepo.find();

  const createdCitizenIds: string[] = [];
  const createdCardIds: string[] = [];
  const createdTransferIds: string[] = [];
  const createdAppIds: string[] = [];
  const createdAcfIds: string[] = [];

  const usedCardNumbers = new Set<string>(
    (await cardRepo.find({ select: { card_number: true } }))
      .map((c) => c.card_number || '')
      .filter(Boolean),
  );
  const usedPhones = new Set<string>(
    (await citizenRepo.find({ select: { phone_number: true } }))
      .map((c) => c.phone_number || '')
      .filter(Boolean),
  );
  const usedPinfls = new Set<string>(
    (await citizenRepo.find({ select: { pinfl: true } })).map((c) => c.pinfl || '').filter(Boolean),
  );
  const usedPassports = new Set<string>(
    (await citizenRepo.find({ select: { passport: true } }))
      .map((c) => c.passport || '')
      .filter(Boolean),
  );

  const genUniqueCardNumber = (bin: string): string => {
    for (;;) {
      let suffix = '';
      while (suffix.length < 16 - bin.length) {
        suffix += String(randInt(0, 9));
      }
      const num = `${bin}${suffix}`.slice(0, 16);
      if (!usedCardNumbers.has(num)) {
        usedCardNumbers.add(num);
        return num;
      }
    }
  };

  const genUniquePhone = (): string => {
    const prefixes = ['90', '91', '93', '94', '97', '99', '88', '77', '95'];
    for (;;) {
      const p = pick(prefixes);
      const rest = String(randInt(1000000, 9999999));
      const full = `998${p}${rest}`;
      if (!usedPhones.has(full)) {
        usedPhones.add(full);
        return full;
      }
    }
  };

  const buildCitizenProfile = (isFemale: boolean) => {
    const firstName = isFemale ? pick(FEMALE_FIRST_NAMES) : pick(MALE_FIRST_NAMES);
    const root = pick(LAST_NAME_ROOTS);
    const patRoot = pick(PATRONYMIC_ROOTS);
    const lastName = isFemale ? `${root}ova` : `${root}ov`;
    const middleName = isFemale
      ? rng() > 0.45
        ? `${patRoot} qizi`
        : `${patRoot}ovna`
      : rng() > 0.45
        ? `${patRoot} o‘g‘li`
        : `${patRoot}ovich`;

    const birthYear = randInt(1962, 2005);
    const birthMonth = randInt(1, 12);
    const birthDay = randInt(1, 28);
    const birthDate = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;

    const centuryDigit = birthYear >= 2000 ? (isFemale ? '6' : '5') : isFemale ? '4' : '3';
    const yy = String(birthYear % 100).padStart(2, '0');
    const dd = String(birthDay).padStart(2, '0');
    const mm = String(birthMonth).padStart(2, '0');

    let pinfl = '';
    for (;;) {
      const tail = String(randInt(1000000, 9999999));
      const cand = `${centuryDigit}${dd}${mm}${yy}${tail}`;
      if (!usedPinfls.has(cand)) {
        usedPinfls.add(cand);
        pinfl = cand;
        break;
      }
    }

    let passport = '';
    const seriesList = ['AD', 'AC', 'AB', 'AE', 'KA'];
    for (;;) {
      const cand = `${pick(seriesList)}${randInt(1000000, 9999999)}`;
      if (!usedPassports.has(cand)) {
        usedPassports.add(cand);
        passport = cand;
        break;
      }
    }

    const district = pick(districts);
    const dMahallas = mahallasByDistrict.get(district.id) ?? [];
    const mahalla = dMahallas.length > 0 ? pick(dMahallas) : null;

    const occCat = occCategories.length > 0 ? pick(occCategories) : null;
    const catOccs = occCat ? occupations.filter((o) => o.category_id === occCat.id) : occupations;
    const occ = catOccs.length > 0 ? pick(catOccs) : null;

    const address = `${mahalla ? `${mahalla.name}, ` : ''}${pick(STREET_NAMES)}, ${randInt(1, 145)}-uy`;

    return {
      first_name: firstName,
      last_name: lastName,
      middle_name: middleName,
      gender: isFemale ? ('female' as const) : ('male' as const),
      birth_date: birthDate,
      pinfl,
      passport,
      phone_number: genUniquePhone(),
      district,
      mahalla,
      occCat,
      occ,
      address,
    };
  };

  log('1/4: Fuqarolar, jabrlanuvchilar va moliyaviy kartalar tarmog‘i yaratilmoqda...');

  // A. 96 nafar Jabrlanuvchi fuqaro + ularning shaxsiy bank kartalari (ba'zilari 2-3 marta murojaat qilgan)
  const victimCitizens: Citizen[] = [];
  const victimPrimaryCards = new Map<string, Card>();

  for (let i = 0; i < 96; i++) {
    const isFemale = rng() < 0.38;
    const p = buildCitizenProfile(isFemale);
    const savedCit = await citizenRepo.save(
      citizenRepo.create({
        first_name: p.first_name,
        last_name: p.last_name,
        middle_name: p.middle_name,
        gender: p.gender,
        birth_date: p.birth_date,
        pinfl: p.pinfl,
        passport: p.passport,
        phone_number: p.phone_number,
        district_id: p.district.id,
        mahalla_id: p.mahalla?.id || null,
        occupation_category_id: p.occCat?.id || null,
        occupation_id: p.occ?.id || null,
        address: p.address,
      }),
    );
    createdCitizenIds.push(savedCit.id);
    victimCitizens.push(savedCit);

    const bankEntry = pick(banksWithBins);
    const cardNum = genUniqueCardNumber(pick(bankEntry.bins));
    const expMonth = String(randInt(1, 12)).padStart(2, '0');
    const expYear = String(randInt(27, 30));
    const savedCard = await cardRepo.save(
      cardRepo.create({
        card_number: cardNum,
        expire_date: `${expMonth}/${expYear}`,
        full_name: `${savedCit.last_name} ${savedCit.first_name}`,
        bank_id: bankEntry.bank.id,
        citizen_id: savedCit.id,
      }),
    );
    createdCardIds.push(savedCard.id);
    victimPrimaryCards.set(savedCit.id, savedCard);
  }

  // B. Uyushgan jinoyat zanjiri kartalari:
  // - 14 ta Dropper karta (bir nechta jabrlanuvchidan pul qabul qiluvchi kartalar; 8 tasining shaxsi aniqlangan!)
  // - 6 ta Tranzit / Jamlovchi karta (Dropper kartalardan yig'ilgan pullarni jamlovchi)
  // - 4 ta Yakuniy Kripto P2P / Naqdlashtirish kartalari
  const dropperCards: Card[] = [];
  for (let i = 0; i < 14; i++) {
    let dropperCitizenId: string | null = null;
    let ownerFullName: string;

    if (i < 8) {
      const p = buildCitizenProfile(rng() < 0.2);
      const dropCit = await citizenRepo.save(
        citizenRepo.create({
          first_name: p.first_name,
          last_name: p.last_name,
          middle_name: p.middle_name,
          gender: p.gender,
          birth_date: p.birth_date,
          pinfl: p.pinfl,
          passport: p.passport,
          phone_number: p.phone_number,
          district_id: p.district.id,
          mahalla_id: p.mahalla?.id || null,
          occupation_category_id: p.occCat?.id || null,
          occupation_id: p.occ?.id || null,
          address: p.address,
        }),
      );
      createdCitizenIds.push(dropCit.id);
      dropperCitizenId = dropCit.id;
      ownerFullName = `${dropCit.last_name} ${dropCit.first_name}`;
    } else {
      const p = buildCitizenProfile(false);
      ownerFullName = `${p.last_name} ${p.first_name}`;
    }

    const bankEntry = pick(banksWithBins);
    const dCard = await cardRepo.save(
      cardRepo.create({
        card_number: genUniqueCardNumber(pick(bankEntry.bins)),
        expire_date: `${String(randInt(1, 12)).padStart(2, '0')}/${randInt(27, 30)}`,
        full_name: ownerFullName,
        bank_id: bankEntry.bank.id,
        citizen_id: dropperCitizenId,
      }),
    );
    createdCardIds.push(dCard.id);
    dropperCards.push(dCard);
  }

  const transitCards: Card[] = [];
  for (let i = 0; i < 6; i++) {
    const p = buildCitizenProfile(false);
    const bankEntry = pick(banksWithBins);
    const tCard = await cardRepo.save(
      cardRepo.create({
        card_number: genUniqueCardNumber(pick(bankEntry.bins)),
        expire_date: `${String(randInt(1, 12)).padStart(2, '0')}/${randInt(27, 30)}`,
        full_name: `${p.last_name} ${p.first_name}`,
        bank_id: bankEntry.bank.id,
      }),
    );
    createdCardIds.push(tCard.id);
    transitCards.push(tCard);
  }

  const cashoutCards: Card[] = [];
  for (let i = 0; i < 4; i++) {
    const p = buildCitizenProfile(false);
    const bankEntry = pick(banksWithBins);
    const cCard = await cardRepo.save(
      cardRepo.create({
        card_number: genUniqueCardNumber(pick(bankEntry.bins)),
        expire_date: `${String(randInt(1, 12)).padStart(2, '0')}/${randInt(28, 30)}`,
        full_name: `${p.last_name} ${p.first_name}`,
        bank_id: bankEntry.bank.id,
      }),
    );
    createdCardIds.push(cCard.id);
    cashoutCards.push(cCard);
  }

  log('2/4: 124 ta realistik murojaat va 150+ jabrlanuvchi o‘tkazmalari yaratilmoqda...');

  const now = new Date();
  const dropperInflowTotals = new Map<string, { total: number; lastDate: string }>();

  const TOTAL_APPLICATIONS = 124;

  for (let idx = 0; idx < TOTAL_APPLICATIONS; idx++) {
    // Sanalarni so'nggi 85 kun bo'ylab tabiiy taqsimlaymiz (oxirgi 30 kunda zichroq)
    const daysAgo = idx < 45 ? randInt(0, 14) : idx < 90 ? randInt(15, 45) : randInt(46, 85);
    const appDate = new Date(now.getTime() - daysAgo * 86_400_000 - randInt(0, 40_000_000));
    const dateIsoYmd = appDate.toISOString().slice(0, 10);
    const timeHm = `${String(randInt(8, 22)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`;

    const victim = victimCitizens[idx % victimCitizens.length];
    const senderCard = victimPrimaryCards.get(victim.id)!;
    const scenario = SCENARIOS[idx % SCENARIOS.length];
    const dropperCard = dropperCards[idx % dropperCards.length];

    const appDistrict = districts.find((d) => d.id === victim.district_id) || pick(districts);

    const crimeMethod =
      methodByCode.get(scenario.methodCode) ||
      (crimeMethods.length > 0 ? pick(crimeMethods) : null);
    const crime =
      scenario.methodCode === '1' || scenario.methodCode === '6' ? crimes[1] : crimes[0];

    const provider = pick(providers);
    const rawAmount = Math.round(randInt(scenario.minAmount, scenario.maxAmount) / 50_000) * 50_000;
    const amountFormatted = rawAmount.toLocaleString('ru-RU');

    const suspectPhone = pick(scenario.suspectPhones);
    const suspectTelegram = pick(scenario.suspectTelegrams);

    const { description, officerNotes } = scenario.buildDescription({
      victimName: `${victim.last_name || ''} ${victim.first_name || ''}`.trim(),
      districtName: appDistrict.name || 'Qashqadaryo viloyati',
      amountFormatted,
      cardLast4: (senderCard.card_number || '0000').slice(-4),
      providerName: provider.name || 'To‘lov tizimi',
      suspectHandle: suspectTelegram,
      dateLabel: dateIsoYmd,
    });

    // Status taqsimoti: yangi arizalar ko'proq YANGI/JARAYONDA, eski arizalarda HAL_QILINDI ham bor
    const roll = rng();
    let chosenStatusEntity = statusNew;
    let chosenStatusCode = 'YANGI';
    if (daysAgo > 20 && roll < 0.28 && statusResolved) {
      chosenStatusEntity = statusResolved;
      chosenStatusCode = statusResolved.code || 'HAL_QILINDI';
    } else if (roll < 0.62 && statusProgress) {
      chosenStatusEntity = statusProgress;
      chosenStatusCode = statusProgress.code || 'JARAYONDA';
    } else if (daysAgo > 30 && roll > 0.92 && statusRejected) {
      chosenStatusEntity = statusRejected;
      chosenStatusCode = statusRejected.code || 'RAD_ETILDI';
    } else if (statusNew) {
      chosenStatusEntity = statusNew;
      chosenStatusCode = statusNew.code || 'YANGI';
    }

    // Gumonlanuvchi raqamli belgilari (SuspectTree)
    const suspectTree: Array<SuspectTreeNode & Record<string, unknown>> = [
      {
        id: randomUUID(),
        field_key: 'phone_number',
        field_label: 'Telefon raqami',
        label: 'Telefon raqami',
        value: suspectPhone,
        note: 'Muloqot va qo‘ng‘iroqda foydalanilgan raqam',
      },
      {
        id: randomUUID(),
        field_key: 'telegram_username',
        field_label: 'Telegram Username',
        label: 'Telegram Username',
        value: suspectTelegram,
        note: 'Murojaatchi bilan yozishma olib borgan profil',
      },
    ];

    if (scenario.suspectInstagrams && scenario.suspectInstagrams.length > 0 && rng() < 0.6) {
      const ig = pick(scenario.suspectInstagrams);
      suspectTree.push({
        id: randomUUID(),
        field_key: 'instagram_username',
        field_label: 'Instagram sahifasi',
        label: 'Instagram sahifasi',
        value: ig,
        note: 'Soxta savdo e‘loni joylashtirilgan sahifa',
      });
    }

    if (scenario.suspectUrls && scenario.suspectUrls.length > 0 && rng() < 0.55) {
      const url = pick(scenario.suspectUrls);
      suspectTree.push({
        id: randomUUID(),
        field_key: 'website_url',
        field_label: 'Veb-sayt / Havola',
        label: 'Veb-sayt / Havola',
        value: url,
        note: 'Jabrlanuvchiga yuborilgan fishing havola',
      });
    }

    if (scenario.suspectIps && scenario.suspectIps.length > 0 && rng() < 0.5) {
      const ip = pick(scenario.suspectIps);
      suspectTree.push({
        id: randomUUID(),
        field_key: 'ip_address',
        field_label: 'IP manzil',
        label: 'IP manzil',
        value: ip,
        note: 'Tranzaksiya sessiyasida qayd etilgan IP manzil',
      });
    }

    const appNumber = `M0110224/2026-${20101 + idx}`;
    const source = sources.length > 0 ? pick(sources) : null;
    const deptService = deptServices.length > 0 ? pick(deptServices) : null;
    const decisionType =
      chosenStatusCode === 'HAL_QILINDI' && decisionTypes.length > 0 ? pick(decisionTypes) : null;
    const rejectionReason =
      chosenStatusCode === 'RAD_ETILDI' && rejectionReasons.length > 0
        ? pick(rejectionReasons)
        : null;

    // 1. Asosiy Transferni saqlaymiz
    const primaryTransfer = await transferRepo.save(
      transferRepo.create({
        transaction_id: `TXN-2026-${810000 + idx * 3}`,
        amount: rawAmount,
        currency: 'UZS',
        status: TransferStatus.MUVAFFAQIYATLI,
        transfer_date: dateIsoYmd,
        transfer_time: timeHm,
        payment_provider_id: provider.id,
        sender_card_id: senderCard.id,
        receiver_card_id: dropperCard.id,
        card_id: senderCard.id,
      }),
    );
    createdTransferIds.push(primaryTransfer.id);

    const prevDrop = dropperInflowTotals.get(dropperCard.id) ?? {
      total: 0,
      lastDate: dateIsoYmd,
    };
    prevDrop.total += rawAmount;
    if (dateIsoYmd > prevDrop.lastDate) prevDrop.lastDate = dateIsoYmd;
    dropperInflowTotals.set(dropperCard.id, prevDrop);

    // 2. Arizani saqlaymiz
    const savedApp = await appRepo.save(
      appRepo.create({
        application_number: appNumber,
        description,
        officer_notes: officerNotes,
        suspect_tree: suspectTree,
        status: chosenStatusCode,
        status_id: chosenStatusEntity?.id || null,
        date: appDate,
        citizen_id: victim.id,
        district_id: appDistrict.id,
        crime_id: crime.id,
        crime_method_id: crimeMethod?.id || null,
        card_id: senderCard.id,
        transfer_id: primaryTransfer.id,
        source_id: source?.id || null,
        department_service_id: deptService?.id || null,
        decision_type_id: decisionType?.id || null,
        rejection_reason_id: rejectionReason?.id || null,
        is_deleted: false,
      }),
    );
    createdAppIds.push(savedApp.id);

    await transferRepo.update(primaryTransfer.id, { application_id: savedApp.id });

    // 3. Har 4-arizada jabrlanuvchi ikkinchi transh (qo'shimcha o'tkazma) ham yuborgan bo'ladi (~31 ta qo'shimcha o'tkazma!)
    if (idx % 4 === 0) {
      const secondDropper = dropperCards[(idx + 3) % dropperCards.length];
      const secondAmount = Math.round((rawAmount * 0.45) / 50_000) * 50_000 || 350_000;
      const secondProvider = pick(providers);
      const secondTransfer = await transferRepo.save(
        transferRepo.create({
          transaction_id: `TXN-2026-${810000 + idx * 3 + 1}`,
          amount: secondAmount,
          currency: 'UZS',
          status: TransferStatus.MUVAFFAQIYATLI,
          transfer_date: dateIsoYmd,
          transfer_time: `${String(Math.min(23, Number(timeHm.slice(0, 2)) + 1)).padStart(2, '0')}:${timeHm.slice(3, 5)}`,
          payment_provider_id: secondProvider.id,
          sender_card_id: senderCard.id,
          receiver_card_id: secondDropper.id,
          card_id: senderCard.id,
          application_id: savedApp.id,
        }),
      );
      createdTransferIds.push(secondTransfer.id);

      const savedAcf = await acfRepo.save(
        acfRepo.create({
          application_id: savedApp.id,
          label: 'Qo‘shimcha o‘tkazma #2',
          key: `transfer_extra_${idx}`,
          type: CustomFieldType.TRANSFER,
          value: `${secondAmount.toLocaleString('ru-RU')} UZS`,
          card_id: senderCard.id,
          transfer_id: secondTransfer.id,
          order: 0,
        }),
      );
      createdAcfIds.push(savedAcf.id);

      const prevDrop2 = dropperInflowTotals.get(secondDropper.id) ?? {
        total: 0,
        lastDate: dateIsoYmd,
      };
      prevDrop2.total += secondAmount;
      if (dateIsoYmd > prevDrop2.lastDate) prevDrop2.lastDate = dateIsoYmd;
      dropperInflowTotals.set(secondDropper.id, prevDrop2);
    }
  }

  log(
    '3/4: Ko‘p bosqichli tranzit va P2P naqdlashtirish pul oqimlari (Dropper -> Tranzit -> Cashout) yaratilmoqda...',
  );

  // 4. Hop-2: Dropper kartalardan Tranzit (Jamlovchi) kartalarga pul ko'chirilishi (28 ta o'tkazma)
  const transitInflowTotals = new Map<string, { total: number; lastDate: string }>();
  let transitSeq = 1;

  for (let dIdx = 0; dIdx < dropperCards.length; dIdx++) {
    const dCard = dropperCards[dIdx];
    const inflow = dropperInflowTotals.get(dCard.id);
    if (!inflow || inflow.total <= 0) continue;

    // Har bir dropper 2 ta tranzit kartaga bo'lib o'tkazadi
    for (let split = 0; split < 2; split++) {
      const tCard = transitCards[(dIdx + split) % transitCards.length];
      const portion = Math.round((inflow.total * (split === 0 ? 0.52 : 0.38)) / 100_000) * 100_000;
      if (portion <= 0) continue;

      const prov = pick(providers);
      const hop2Transfer = await transferRepo.save(
        transferRepo.create({
          transaction_id: `TRZ-2026-${910000 + transitSeq++}`,
          amount: portion,
          currency: 'UZS',
          status: TransferStatus.MUVAFFAQIYATLI,
          transfer_date: inflow.lastDate,
          transfer_time: `${String(randInt(14, 23)).padStart(2, '0')}:${String(randInt(10, 58)).padStart(2, '0')}`,
          payment_provider_id: prov.id,
          sender_card_id: dCard.id,
          receiver_card_id: tCard.id,
          card_id: dCard.id,
        }),
      );
      createdTransferIds.push(hop2Transfer.id);

      const prevT = transitInflowTotals.get(tCard.id) ?? {
        total: 0,
        lastDate: inflow.lastDate,
      };
      prevT.total += portion;
      if (inflow.lastDate > prevT.lastDate) prevT.lastDate = inflow.lastDate;
      transitInflowTotals.set(tCard.id, prevT);
    }
  }

  // 5. Hop-3: Tranzit kartalardan Kripto P2P / Naqdlashtirish kartalariga chiqarish (12 ta yirik o'tkazma)
  let cashoutSeq = 1;
  for (let tIdx = 0; tIdx < transitCards.length; tIdx++) {
    const tCard = transitCards[tIdx];
    const tInflow = transitInflowTotals.get(tCard.id);
    if (!tInflow || tInflow.total <= 0) continue;

    for (let split = 0; split < 2; split++) {
      const cCard = cashoutCards[(tIdx + split) % cashoutCards.length];
      const portion = Math.round((tInflow.total * (split === 0 ? 0.55 : 0.37)) / 100_000) * 100_000;
      if (portion <= 0) continue;

      const prov = pick(providers);
      const hop3Transfer = await transferRepo.save(
        transferRepo.create({
          transaction_id: `CSH-2026-${950000 + cashoutSeq++}`,
          amount: portion,
          currency: 'UZS',
          status: TransferStatus.MUVAFFAQIYATLI,
          transfer_date: tInflow.lastDate,
          transfer_time: `${String(randInt(18, 23)).padStart(2, '0')}:${String(randInt(10, 59)).padStart(2, '0')}`,
          payment_provider_id: prov.id,
          sender_card_id: tCard.id,
          receiver_card_id: cCard.id,
          card_id: tCard.id,
        }),
      );
      createdTransferIds.push(hop3Transfer.id);
    }
  }

  log('4/4: 360° Dosye, Jonli Radar va Bog‘liqliklar indeksi sinxronlanmoqda...');
  await intelligenceSync.syncAllExistingData();

  // IntelligenceSync tomonidan yangi yaratilgan telefon, identifikator va bog'liqliklarni aniqlaymiz
  const postPhoneIds = (await ds.getRepository(PhoneEntity).find({ select: { id: true } }))
    .map((x) => x.id)
    .filter((id) => !prePhoneIds.has(id));
  const postIdentIds = (
    await ds.getRepository(DigitalIdentifierEntity).find({ select: { id: true } })
  )
    .map((x) => x.id)
    .filter((id) => !preIdentIds.has(id));
  const postLinkIds = (await ds.getRepository(EntityApplicationLink).find({ select: { id: true } }))
    .map((x) => x.id)
    .filter((id) => !preLinkIds.has(id));

  await registerMockIds(ds, 'citizens', createdCitizenIds);
  await registerMockIds(ds, 'cards', createdCardIds);
  await registerMockIds(ds, 'transfers', createdTransferIds);
  await registerMockIds(ds, 'applications', createdAppIds);
  await registerMockIds(ds, 'application_custom_fields', createdAcfIds);
  await registerMockIds(ds, 'phones', postPhoneIds);
  await registerMockIds(ds, 'digital_identifiers', postIdentIds);
  await registerMockIds(ds, 'entity_application_links', postLinkIds);

  log('==============================================================');
  log('MOCK MA‘LUMOTLAR MUVAFFAQIYATLI KIRITILDI!');
  log(`- Arizalar:               ${createdAppIds.length} ta`);
  log(`- Pul o‘tkazmalari:       ${createdTransferIds.length} ta`);
  log(`- Fuqarolar:              ${createdCitizenIds.length} ta`);
  log(`- Plastik kartalar:       ${createdCardIds.length} ta`);
  log(`- Raqamli identifikator:  ${postIdentIds.length} ta`);
  log(`- Tahliliy bog‘liqliklar: ${postLinkIds.length} ta`);
  log('Tozalash uchun: npm run mockdata:clean');
  log('==============================================================');
}

async function bootstrap() {
  const action = (process.argv[2] || 'seed').toLowerCase();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const ds = app.get(DataSource);
    const intelligenceSync = app.get(IntelligenceSyncService);

    if (action === 'clean' || action === 'clear' || action === 'remove') {
      await cleanMockData(ds, intelligenceSync);
    } else {
      await seedMockData(ds, intelligenceSync);
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((err) => {
  console.error('Mockdata skriptida xatolik yuz berdi:', err);
  process.exit(1);
});
