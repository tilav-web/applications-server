import { Application } from '../../application.entity';
import { Transfer } from '../../transfers/transfer.entity';
import {
  adaptToScript,
  formatAmountNumber,
  formatDateUzbek,
  numberToWordsUz,
} from '../utils/transliterate.util';

export interface TemplateDataContext {
  citizen: Record<string, any>;
  application: Record<string, any>;
  crime: Record<string, any>;
  district: Record<string, any>;
  victim_card: Record<string, any>;
  fraud_card: Record<string, any>;
  transfers: Array<Record<string, any>>;
  officer: Record<string, any>;
  head: Record<string, any>;
  current_date: string;
  current_date_text: string;
  current_year: string;
  // Aliases for backwards compatibility
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

  // 5. Script adaptation helper
  const adapt = (val?: string | null) => {
    if (!val) return '';
    return script === 'krill' ? adaptToScript(val, 'krill') : val;
  };

  // 6. Build transfers list
  const formattedTransfers = transfers.map((t, idx) => ({
    index: String(idx + 1),
    from_card: formatCardSpaced(t.sender_card?.card_number || victimCard?.card_number),
    to_card: formatCardSpaced(t.receiver_card?.card_number),
    amount: `${formatAmountNumber(t.amount)} ${script === 'krill' ? 'сўм' : 'so‘m'}`,
    amount_words: numberToWordsUz(t.amount, script),
    currency: t.currency || 'UZS',
    transfer_date: t.transfer_date || '',
    transfer_time: t.transfer_time || '',
    transaction_id: t.transaction_id || '',
    provider_name: adapt(t.payment_provider?.name || ''),
    payment_provider: {
      name: adapt(t.payment_provider?.name || ''),
    },
    status: adapt(t.status || ''),
  }));

  // Context structured cleanly according to real Entity Models
  const context: TemplateDataContext = {
    // 1. Citizen Model
    citizen: {
      first_name: adapt(cFirst),
      last_name: adapt(cLast),
      middle_name: adapt(cMiddle),
      phone_number: citizen?.phone_number || '',
      passport: citizen?.passport || '',
      pinfl: citizen?.pinfl || '',
      birth_date: citizenBirthDateRaw,
      birth_date_text: adapt(citizenBirthDateText),
      gender: adapt(citizen?.gender === 'female' ? 'Ayol' : 'Erkak'),
      address: adapt(citizenFullAddress),
      district: {
        name: adapt(citizenDistrictName),
      },
      mahalla: {
        name: adapt(citizenMahallaName),
      },
      // Backwards-compatible aliases
      full_name: adapt(cFullName),
      short_name: adapt(cShortName),
      phone: citizen?.phone_number || '',
      workplace: adapt(customData.workplace || 'Vaqtincha ishsiz'),
      marital_status: adapt(customData.maritalStatus || 'Oilaliman'),
      education: adapt(customData.education || 'Oliy'),
      criminal_record: adapt(customData.criminalRecord || 'Sudlanmaganman'),
    },

    // 2. Application Model
    application: {
      application_number: application.application_number || 'YANGI',
      date: formatDateUzbek(application.date || application.created_at, script),
      description: adapt(application.description || ''),
      officer_notes: adapt(application.officer_notes || ''),
      status: adapt(application.status || ''),
    },

    // 3. Crime Model
    crime: {
      article: adapt(crime?.article || '168-modda'),
      part: adapt(crime?.part || ''),
      title: adapt(crime?.title || ''),
      description: adapt(crime?.description || crime?.title || ''),
    },

    // 4. District Model
    district: {
      name: adapt(district?.name || citizenDistrictName || ''),
    },

    // 5. Victim Card Model
    victim_card: {
      card_number: formatCardSpaced(victimCard?.card_number),
      masked_number: maskCard(victimCard?.card_number),
      expire_date: victimCard?.expire_date || '',
      full_name: adapt(victimCard?.full_name || cFullName),
      bank: {
        name: adapt(victimCard?.bank?.name || ''),
      },
      // Aliases
      number: formatCardSpaced(victimCard?.card_number),
      holder: adapt(victimCard?.full_name || cFullName),
    },

    // 6. Fraud Card Model
    fraud_card: {
      card_number: formatCardSpaced(fraudCard?.card_number),
      masked_number: maskCard(fraudCard?.card_number),
      expire_date: fraudCard?.expire_date || '',
      full_name: adapt(fraudCard?.full_name || ''),
      bank: {
        name: adapt(fraudCard?.bank?.name || ''),
      },
      // Aliases
      number: formatCardSpaced(fraudCard?.card_number),
      holder: adapt(fraudCard?.full_name || ''),
    },

    // 7. Transfers List
    transfers: formattedTransfers,

    // 8. Officer Model
    officer: {
      first_name: adapt(officerFirstName),
      last_name: adapt(officerLastName),
      phone_number: officerUser?.phone_number || '',
      position: adapt(officerPosition),
      // Aliases
      full_name: adapt(officerFullName),
      phone: officerUser?.phone_number || '',
    },

    // 9. Head of Department
    head: {
      title: headTitle,
      position_and_name: headTitle,
    },

    // 10. Dates
    current_date: currentDateFormatted,
    current_date_text: currentDateText,
    current_year: String(now.getFullYear()),

    // Backwards compatibility alias for app.*
    app: {
      number: application.application_number || 'YANGI',
      created_date: formatDateUzbek(application.date || application.created_at, script),
      crime_article: crime?.article
        ? `${crime.article} ${crime.part || ''} (${crime.title || crime.description || ''})`.trim()
        : '168-modda',
      district: adapt(district?.name || ''),
      stolen_amount: formatAmountNumber(totalStolenAmount),
      stolen_amount_words: numberToWordsUz(totalStolenAmount, script),
      description: adapt(application.description || ''),
      status: adapt(application.status || ''),
    },

    // Flat legacy aliases
    citizenFullName: adapt(cFullName),
    citizenShortName: adapt(cShortName),
    citizenAddress: adapt(citizenFullAddress),
    citizenPhone: citizen?.phone_number || '',
    citizenBirthDate: adapt(citizenBirthDateText),
    cardNumber: formatCardSpaced(victimCard?.card_number),
    fraudCardNumber: formatCardSpaced(fraudCard?.card_number),
    stolenAmount: formatAmountNumber(totalStolenAmount),
    stolenAmountWords: numberToWordsUz(totalStolenAmount, script),
    officerName: adapt(officerFullName),
    officerPosition: adapt(officerPosition),
    dateText: currentDateText,
  };

  return context;
}
