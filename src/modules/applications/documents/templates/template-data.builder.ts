import { Application } from '../../application.entity';
import { Transfer } from '../../transfers/transfer.entity';
import {
  adaptToScript,
  formatAmountNumber,
  formatDateUzbek,
  numberToWordsUz,
} from '../utils/transliterate.util';

export interface TemplateDataContext {
  citizen: Record<string, string>;
  app: Record<string, string>;
  victim_card: Record<string, string>;
  fraud_card: Record<string, string>;
  transfers: Array<Record<string, string>>;
  officer: Record<string, string>;
  head: Record<string, string>;
  current_date: string;
  current_date_text: string;
  current_year: string;
  // Flat legacy aliases for backwards compatibility
  [key: string]: any;
}

export function buildTemplateContext(
  application: Application,
  transfers: Transfer[] = [],
  officerUser: any = null,
  script: 'lotin' | 'krill' = 'lotin',
  customData: Record<string, string> = {},
): TemplateDataContext {
  const citizen = application.citizen;
  const crime = application.crime;
  const district = application.district;

  // 1. Citizen data
  const cFirst = citizen?.first_name || '';
  const cLast = citizen?.last_name || '';
  const cMiddle = citizen?.middle_name || '';
  const cFullName = [cLast, cFirst, cMiddle].filter(Boolean).join(' ') || (citizen?.passport ? `Fuqaro (${citizen.passport})` : 'Fuqaro');
  const cShortName = cLast ? `${cFirst ? cFirst[0] + '.' : ''}${cLast}` : cFullName;

  const citizenDistrictName = citizen?.district?.name || district?.name || '';
  const citizenMahallaName = citizen?.mahalla?.name || '';
  const citizenFullAddress = citizen?.address
    ? citizen.address
    : [citizenDistrictName, citizenMahallaName].filter(Boolean).join(', ');

  const citizenBirthDateRaw = citizen?.birth_date || '';
  const citizenBirthDateText = formatDateUzbek(citizenBirthDateRaw, script);

  // 2. Cards and Transfers
  const victimCard = application.card;
  let primaryTransfer: Transfer | null = application.transfer || (transfers.length > 0 ? transfers[0] : null);
  const fraudCard = primaryTransfer?.receiver_card || null;

  // Masked card number helper
  const maskCard = (num?: string | null) => {
    if (!num) return '';
    const clean = num.replace(/\D/g, '');
    if (clean.length === 16) {
      return `${clean.slice(0, 4)} **** **** ${clean.slice(12)}`;
    }
    return num;
  };

  // Format card number with spaces (8600 1234 5678 9012)
  const formatCardSpaced = (num?: string | null) => {
    if (!num) return '';
    const clean = num.replace(/\D/g, '');
    if (clean.length === 16) {
      return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 12)} ${clean.slice(12)}`;
    }
    return num;
  };

  // Total stolen amount
  let totalStolenAmount = 0;
  if (primaryTransfer?.amount) {
    totalStolenAmount = Number(primaryTransfer.amount);
  } else if (transfers.length > 0) {
    totalStolenAmount = transfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }

  // 3. Officer / Investigator info
  const officerFirstName = officerUser?.first_name || '';
  const officerLastName = officerUser?.last_name || '';
  const officerFullName = [officerLastName, officerFirstName].filter(Boolean).join(' ') || 'Tergovchi';
  const officerPosition =
    customData.officerPosition ||
    'Qashqadaryo viloyati IIB TXTB TB KTV katta tergovchisi';

  const defaultHeadTitleLotin = 'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga';
  const defaultHeadTitleKrill = 'Қашқадарё вилояти ИИБ бошлиғи полковник А.С.Исмоиловга';
  const headTitle = customData.headTitle || (script === 'krill' ? defaultHeadTitleKrill : defaultHeadTitleLotin);

  // 4. Dates
  const now = new Date();
  const currentDateFormatted = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
  const currentDateText = formatDateUzbek(now, script);

  // 5. Build transfers list for loop/table {{#transfers}}...{{/transfers}}
  const formattedTransfers = transfers.map((t, idx) => ({
    index: String(idx + 1),
    from_card: formatCardSpaced(t.sender_card?.card_number || victimCard?.card_number),
    to_card: formatCardSpaced(t.receiver_card?.card_number),
    amount: `${formatAmountNumber(t.amount)} ${script === 'krill' ? 'сўм' : 'so‘m'}`,
    amount_words: numberToWordsUz(t.amount, script),
    transfer_date: t.transfer_date || '',
    transfer_time: t.transfer_time || '',
    provider_name: t.payment_provider?.name || '',
    status: t.status || '',
  }));

  // Base raw context in Latin
  const rawContext = {
    citizen: {
      full_name: cFullName,
      short_name: cShortName,
      first_name: cFirst,
      last_name: cLast,
      middle_name: cMiddle,
      passport: citizen?.passport || '',
      pinfl: citizen?.pinfl || '',
      phone: citizen?.phone_number || '',
      birth_date: citizenBirthDateRaw,
      birth_date_text: citizenBirthDateText,
      gender: citizen?.gender === 'female' ? 'Ayol' : 'Erkak',
      address: citizenFullAddress,
      district: citizenDistrictName,
      mahalla: citizenMahallaName,
      workplace: customData.workplace || 'Vaqtincha ishsiz',
      marital_status: customData.maritalStatus || 'Oilaliman',
      education: customData.education || 'Oliy',
      criminal_record: customData.criminalRecord || 'Sudlanmaganman',
    },
    app: {
      number: application.application_number || 'YANGI',
      created_date: formatDateUzbek(application.date || application.created_at, script),
      crime_article: crime?.article
        ? `${crime.article} ${crime.part || ''} (${crime.title || crime.description || ''})`.trim()
        : '168-modda',
      district: district?.name || '',
      stolen_amount: formatAmountNumber(totalStolenAmount),
      stolen_amount_words: numberToWordsUz(totalStolenAmount, script),
      description: application.description || '',
      status: application.status || '',
    },
    victim_card: {
      number: formatCardSpaced(victimCard?.card_number),
      masked_number: maskCard(victimCard?.card_number),
      holder: victimCard?.full_name || cFullName,
      bank: victimCard?.bank?.name || '',
    },
    fraud_card: {
      number: formatCardSpaced(fraudCard?.card_number),
      masked_number: maskCard(fraudCard?.card_number),
      holder: fraudCard?.full_name || '',
      bank: fraudCard?.bank?.name || '',
    },
    transfers: formattedTransfers,
    officer: {
      full_name: officerFullName,
      position: officerPosition,
      phone: officerUser?.phone_number || '',
    },
    head: {
      title: headTitle,
      position_and_name: headTitle,
    },
    current_date: currentDateFormatted,
    current_date_text: currentDateText,
    current_year: String(now.getFullYear()),
  };

  // Convert to script if Kirill is requested
  const adapt = (val: string) => (script === 'krill' ? adaptToScript(val, 'krill') : val);

  const localizedContext: TemplateDataContext = {
    citizen: {
      full_name: adapt(rawContext.citizen.full_name),
      short_name: adapt(rawContext.citizen.short_name),
      first_name: adapt(rawContext.citizen.first_name),
      last_name: adapt(rawContext.citizen.last_name),
      middle_name: adapt(rawContext.citizen.middle_name),
      passport: rawContext.citizen.passport, // Pasport series (e.g. AA 1234567) is Latin
      pinfl: rawContext.citizen.pinfl,
      phone: rawContext.citizen.phone,
      birth_date: rawContext.citizen.birth_date,
      birth_date_text: adapt(rawContext.citizen.birth_date_text),
      gender: adapt(rawContext.citizen.gender),
      address: adapt(rawContext.citizen.address),
      district: adapt(rawContext.citizen.district),
      mahalla: adapt(rawContext.citizen.mahalla),
      workplace: adapt(rawContext.citizen.workplace),
      marital_status: adapt(rawContext.citizen.marital_status),
      education: adapt(rawContext.citizen.education),
      criminal_record: adapt(rawContext.citizen.criminal_record),
    },
    app: {
      number: rawContext.app.number,
      created_date: adapt(rawContext.app.created_date),
      crime_article: adapt(rawContext.app.crime_article),
      district: adapt(rawContext.app.district),
      stolen_amount: rawContext.app.stolen_amount,
      stolen_amount_words: rawContext.app.stolen_amount_words,
      description: adapt(rawContext.app.description),
      status: adapt(rawContext.app.status),
    },
    victim_card: {
      number: rawContext.victim_card.number,
      masked_number: rawContext.victim_card.masked_number,
      holder: adapt(rawContext.victim_card.holder),
      bank: adapt(rawContext.victim_card.bank),
    },
    fraud_card: {
      number: rawContext.fraud_card.number,
      masked_number: rawContext.fraud_card.masked_number,
      holder: adapt(rawContext.fraud_card.holder),
      bank: adapt(rawContext.fraud_card.bank),
    },
    transfers: rawContext.transfers.map((t) => ({
      ...t,
      amount_words: adapt(t.amount_words),
      provider_name: adapt(t.provider_name),
    })),
    officer: {
      full_name: adapt(rawContext.officer.full_name),
      position: adapt(rawContext.officer.position),
      phone: rawContext.officer.phone,
    },
    head: {
      title: headTitle,
      position_and_name: headTitle,
    },
    current_date: rawContext.current_date,
    current_date_text: adapt(rawContext.current_date_text),
    current_year: rawContext.current_year,

    // Flat legacy aliases for templates using flat variables
    citizenFullName: adapt(rawContext.citizen.full_name),
    citizenShortName: adapt(rawContext.citizen.short_name),
    citizenAddress: adapt(rawContext.citizen.address),
    citizenPhone: rawContext.citizen.phone,
    citizenBirthDate: adapt(rawContext.citizen.birth_date_text),
    maritalStatus: adapt(rawContext.citizen.marital_status),
    education: adapt(rawContext.citizen.education),
    criminalRecord: adapt(rawContext.citizen.criminal_record),
    workplace: adapt(rawContext.citizen.workplace),
    cardNumber: rawContext.victim_card.number,
    cardHolder: adapt(rawContext.victim_card.holder),
    cardBank: adapt(rawContext.victim_card.bank),
    fraudCardNumber: rawContext.fraud_card.number,
    fraudCardHolder: adapt(rawContext.fraud_card.holder),
    fraudCardBank: adapt(rawContext.fraud_card.bank),
    stolenAmount: rawContext.app.stolen_amount,
    stolenAmountWords: rawContext.app.stolen_amount_words,
    districtName: adapt(rawContext.app.district),
    dateText: adapt(rawContext.current_date_text),
    officerName: adapt(rawContext.officer.full_name),
    officerPosition: adapt(rawContext.officer.position),
    headTitle: headTitle,
    phoneModel: customData.phoneModel ? adapt(customData.phoneModel) : '',
    telegramUsagePeriod: customData.telegramUsagePeriod ? adapt(customData.telegramUsagePeriod) : '',
    compromiseDate: customData.compromiseDate ? adapt(customData.compromiseDate) : '',
    friendInfo: customData.friendInfo ? adapt(customData.friendInfo) : '',
    fakeAppName: customData.fakeAppName ? adapt(customData.fakeAppName) : '',
  };

  return localizedContext;
}
