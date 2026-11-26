import {
  APPEAL_TYPE_LABELS,
  AppealType,
  APPLICANT_TYPE_LABELS,
  ApplicantType,
  ApplicationRepeatType,
  REPEAT_TYPE_LABELS,
  SUBMISSION_FORM_LABELS,
  SubmissionForm,
} from '../../../../common/enums/appeal-classification.enum';
import { formatTitleCase, formatUzbekName } from '../../../../common/utils/name-formatter.util';
import { splitFullNameParts } from '../../../../common/utils/normalization.util';
import { Application } from '../../application.entity';
import { Transfer } from '../../transfers/transfer.entity';
import {
  adaptToScript,
  formatAmountNumber,
  formatDateUzbek,
  numberToWordsUz,
} from '../utils/transliterate.util';

export interface TemplateOfficerUser {
  id?: string;
  sub?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  username?: string | null;
  auth?: {
    username?: string | null;
    role?: string | null;
  } | null;
}

interface RawSuspectItem {
  id?: string;
  field_key?: string;
  key?: string;
  field_label?: string;
  label?: string;
  value?: string;
  note?: string;
  description?: string;
  children?: RawSuspectItem[];
}

export interface TemplateDataContext {
  citizen: Record<string, unknown>;
  application: Record<string, unknown>;
  crime: Record<string, unknown>;
  district: Record<string, unknown>;
  victim_card: Record<string, unknown>;
  fraud_card: Record<string, unknown>;
  suspect: Record<string, unknown>;
  suspect_list?: Array<Record<string, unknown>>;
  suspect_tree: Array<Record<string, unknown>>;
  transfer: Record<string, unknown>;
  transfers: Array<Record<string, unknown>>;
  custom: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  officer: Record<string, unknown>;
  head: Record<string, unknown>;
  total_stolen_amount: string;
  total_stolen_amount_words: string;
  total_amount: string;
  total_amount_words: string;
  current_date: string;
  current_date_text: string;
  current_year: string;
  // Aliases for backwards compatibility
  [key: string]: unknown;
}

export function buildTemplateContext(
  application: Application,
  transfers: Transfer[] = [],
  officerUser: TemplateOfficerUser | null = null,
  script: 'lotin' | 'krill' = 'lotin',
  customData: Record<string, string> = {},
): TemplateDataContext {
  const citizen = application.citizen;
  const crime = application.crime;
  const district = application.district;
  const appStatus = application.application_status;

  // 1. Script adaptation helper
  const adapt = (val?: string | null) => {
    if (!val) return '';
    return script === 'krill' ? adaptToScript(val, 'krill') : val;
  };

  // 2. Citizen data
  const cFullNameRaw = formatUzbekName(citizen?.full_name);
  const cParts = splitFullNameParts(cFullNameRaw);
  const cFirst = cParts.first_name;
  const cLast = cParts.last_name;
  const cMiddle = cParts.middle_name;
  const cFullName = cFullNameRaw || (citizen?.passport ? `Fuqaro (${citizen.passport})` : 'Fuqaro');
  const cShortName = cLast ? `${cFirst ? cFirst[0] + '.' : ''}${cLast}` : cFullName;

  const citizenDistrictName = citizen?.district?.name || district?.name || '';
  const citizenNeighborhoodName = citizen?.neighborhood?.name || '';
  const citizenFullAddress = citizen?.address
    ? citizen.address
    : [citizenDistrictName, citizenNeighborhoodName].filter(Boolean).join(', ');

  const citizenBirthDateRaw = citizen?.birth_date || '';
  const citizenBirthDateText = formatDateUzbek(citizenBirthDateRaw, script);

  // 3. Cards and Transfers
  const victimCard = application.card;
  const primaryTransfer: Transfer | null =
    application.transfer || (transfers.length > 0 ? transfers[0] : null);
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
  let totalStolenAmountNumber = 0;
  if (primaryTransfer?.amount) {
    totalStolenAmountNumber = Number(primaryTransfer.amount);
  } else if (transfers.length > 0) {
    totalStolenAmountNumber = transfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }

  // 4. Officer / Investigator info
  const officerFirstName = officerUser?.first_name || '';
  const officerLastName = officerUser?.last_name || '';
  const officerFullName =
    [officerLastName, officerFirstName].filter(Boolean).join(' ') || 'Tergovchi';
  const officerPosition =
    customData.officerPosition || 'Qashqadaryo viloyati IIB TXTB TB KTV katta tergovchisi';

  const defaultHeadTitleLotin = 'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga';
  const defaultHeadTitleKrill = 'Қашқадарё вилояти ИИБ бошлиғи полковник А.С.Исмоиловга';
  const headTitle =
    customData.headTitle || (script === 'krill' ? defaultHeadTitleKrill : defaultHeadTitleLotin);

  // 5. Dates
  const now = new Date();
  const currentDateFormatted = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
  const currentDateText = formatDateUzbek(now, script);

  // 6. Build transfers list (Loop block: {{#transfers}}...{{/transfers}})
  const formattedTransfers = transfers.map((t, idx) => ({
    index: String(idx + 1),
    id: t.id || '',
    transaction_id: t.transaction_id || '',
    amount: formatAmountNumber(t.amount),
    amount_words: numberToWordsUz(t.amount, script),
    currency: t.currency || 'UZS',
    transfer_date: t.transfer_date || '',
    transfer_time: t.transfer_time || '',
    status: adapt(t.status || ''),
    from_card: formatCardSpaced(t.sender_card?.card_number || victimCard?.card_number),
    to_card: formatCardSpaced(t.receiver_card?.card_number),
    sender_card: {
      card_number: formatCardSpaced(t.sender_card?.card_number),
      masked_number: maskCard(t.sender_card?.card_number),
      full_name: adapt(formatUzbekName(t.sender_card?.full_name || '')),
      bank: {
        name: adapt(t.sender_card?.bank?.name || ''),
        code: t.sender_card?.bank?.code || '',
        mfo: t.sender_card?.bank?.mfo || '',
      },
    },
    receiver_card: {
      card_number: formatCardSpaced(t.receiver_card?.card_number),
      masked_number: maskCard(t.receiver_card?.card_number),
      full_name: adapt(formatUzbekName(t.receiver_card?.full_name || '')),
      bank: {
        name: adapt(t.receiver_card?.bank?.name || ''),
        code: t.receiver_card?.bank?.code || '',
        mfo: t.receiver_card?.bank?.mfo || '',
      },
    },
    payment_provider: {
      name: adapt(t.payment_provider?.name || ''),
      code: t.payment_provider?.code || '',
    },
    provider_name: adapt(t.payment_provider?.name || ''),
  }));

  // 6b. Suspect Fields / Tree parser (Firibgar / Gumonlanuvchi ma'lumotlari)
  const rawSuspectData: RawSuspectItem[] = Array.isArray(application.suspect_tree)
    ? application.suspect_tree
    : [];

  const suspectKeyValues: Record<string, string> = {};
  const suspectList: Array<Record<string, unknown>> = [];
  const suspectDetailsLines: string[] = [];

  const branchPaths: string[] = [];
  const leafValues: string[] = [];
  const detectedUsernames: string[] = [];
  const detectedPhones: string[] = [];
  const detectedCards: string[] = [];

  const cleanCardRegex = /\b(?:8600|9860|5614|6262|4\d{3}|5\d{3})[\d\s-]{12,18}\b/;
  const phoneRegex = /(?:\+?998[\s-]?)?[0-9]{2}[\s-]?[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2}/;

  for (let i = 0; i < rawSuspectData.length; i++) {
    const item = rawSuspectData[i];
    if (!item) continue;

    // Check if item is 3-column format: { field_key, value, note }
    if (item.field_key !== undefined || (item.value !== undefined && !item.children)) {
      const key = (item.field_key || item.key || `field_${i + 1}`).trim();
      const val = (item.value || '').trim();
      const note = (item.note || item.description || '').trim();
      const label = (item.field_label || item.label || key).trim();

      if (val) {
        suspectKeyValues[key] = adapt(val);
        if (note) {
          suspectKeyValues[`${key}_note`] = adapt(note);
        }

        if (cleanCardRegex.test(val)) detectedCards.push(val);
        if (phoneRegex.test(val)) detectedPhones.push(val);
        if (val.startsWith('@') || /user|nik|tg/i.test(key)) detectedUsernames.push(val);
        leafValues.push(val);

        const line = `${label}: ${val}${note ? ` (${note})` : ''}`;
        suspectDetailsLines.push(line);

        suspectList.push({
          index: String(suspectList.length + 1),
          key: adapt(key),
          label: adapt(label),
          value: adapt(val),
          note: adapt(note),
          text: adapt(line),
          path: adapt(line),
        });
      }
    } else {
      // Tree format: recursive walk
      const walk = (nodes: RawSuspectItem[], currentPath: string[] = []) => {
        for (const node of nodes) {
          if (!node) continue;
          const text = (node.label || node.value || '').trim();
          if (!text) continue;
          const newPath = [...currentPath, text];
          if (cleanCardRegex.test(text)) detectedCards.push(text);
          if (phoneRegex.test(text)) detectedPhones.push(text);
          if (text.startsWith('@')) detectedUsernames.push(text);
          if (node.children && Array.isArray(node.children) && node.children.length > 0) {
            walk(node.children, newPath);
          } else {
            branchPaths.push(newPath.join(' ➔ '));
            leafValues.push(text);
          }
        }
      };
      walk([item]);
    }
  }

  const allDetails = [...suspectDetailsLines, ...branchPaths];
  const suspectDetailsStr = allDetails.join('; ');
  const suspectUsernamesStr = Array.from(new Set(detectedUsernames)).join(', ');
  const suspectPhonesStr = Array.from(new Set(detectedPhones)).join(', ');
  const suspectCardsStr = Array.from(new Set(detectedCards)).join(', ');
  const suspectSummaryStr = Array.from(new Set(leafValues)).join(', ');

  const formattedSuspectTree = branchPaths.map((p, idx) => {
    const parts = p.split(' ➔ ');
    return {
      index: String(idx + 1),
      path: adapt(p),
      text: adapt(p),
      root: adapt(parts[0] || ''),
      leaf: adapt(parts[parts.length - 1] || ''),
    };
  });

  const finalSuspectList = suspectList.length > 0 ? suspectList : formattedSuspectTree;

  // 7. Dynamic Custom Fields parser
  const customFieldsContext: Record<string, unknown> = {};
  if (application.custom_fields && Array.isArray(application.custom_fields)) {
    for (const cf of application.custom_fields) {
      if (!cf.key) continue;
      if (cf.citizen) {
        const cfFull = formatUzbekName(cf.citizen.full_name);
        const cfParts = splitFullNameParts(cfFull);
        customFieldsContext[cf.key] = {
          full_name: adapt(cfFull),
          first_name: adapt(cfParts.first_name),
          last_name: adapt(cfParts.last_name),
          middle_name: adapt(cfParts.middle_name),
          phone_number: cf.citizen.phone_number || '',
          passport: cf.citizen.passport || '',
          pinfl: cf.citizen.pinfl || '',
          birth_date: cf.citizen.birth_date || '',
          gender: adapt(cf.citizen.gender === 'female' ? 'Ayol' : 'Erkak'),
          address: adapt(cf.citizen.address || ''),
        };
      } else if (cf.card) {
        customFieldsContext[cf.key] = {
          card_number: formatCardSpaced(cf.card.card_number),
          masked_number: cf.card.masked_number || maskCard(cf.card.card_number),
          expire_date: cf.card.expire_date || '',
          full_name: adapt(cf.card.full_name || ''),
          bank: {
            name: adapt(cf.card.bank?.name || ''),
            code: cf.card.bank?.code || '',
            mfo: cf.card.bank?.mfo || '',
          },
        };
      } else if (cf.crime) {
        customFieldsContext[cf.key] = {
          article: adapt(cf.crime.article || ''),
          title: adapt(cf.crime.title || ''),
          description: adapt(cf.crime.description || ''),
        };
      } else if (cf.district) {
        customFieldsContext[cf.key] = {
          name: adapt(cf.district.name || ''),
        };
      } else {
        customFieldsContext[cf.key] = typeof cf.value === 'string' ? adapt(cf.value) : cf.value;
      }
    }
  }

  // 8. Primary Transfer object (for single-transfer shortcuts)
  const primaryTransferContext = primaryTransfer
    ? {
        id: primaryTransfer.id || '',
        transaction_id: primaryTransfer.transaction_id || '',
        amount: formatAmountNumber(primaryTransfer.amount),
        amount_words: numberToWordsUz(primaryTransfer.amount, script),
        currency: primaryTransfer.currency || 'UZS',
        transfer_date: primaryTransfer.transfer_date || '',
        transfer_time: primaryTransfer.transfer_time || '',
        status: adapt(primaryTransfer.status || ''),
        payment_provider: {
          name: adapt(primaryTransfer.payment_provider?.name || ''),
          code: primaryTransfer.payment_provider?.code || '',
        },
        sender_card: {
          card_number: formatCardSpaced(
            primaryTransfer.sender_card?.card_number || victimCard?.card_number,
          ),
          masked_number: maskCard(
            primaryTransfer.sender_card?.card_number || victimCard?.card_number,
          ),
          full_name: adapt(primaryTransfer.sender_card?.full_name || victimCard?.full_name || ''),
        },
        receiver_card: {
          card_number: formatCardSpaced(primaryTransfer.receiver_card?.card_number),
          masked_number: maskCard(primaryTransfer.receiver_card?.card_number),
          full_name: adapt(primaryTransfer.receiver_card?.full_name || ''),
        },
      }
    : {
        id: '',
        transaction_id: '',
        amount: '0',
        amount_words: '',
        currency: 'UZS',
        transfer_date: '',
        transfer_time: '',
        status: '',
        payment_provider: { name: '', code: '' },
        sender_card: { card_number: '', masked_number: '', full_name: '' },
        receiver_card: { card_number: '', masked_number: '', full_name: '' },
      };

  // 9. Full Context structured cleanly according to real Entity Models
  const context: TemplateDataContext = {
    // ------------------------------------------------------------------------
    // Model 1: Citizen (Arizachi fuqaro)
    // ------------------------------------------------------------------------
    citizen: {
      id: citizen?.id || '',
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
        id: citizen?.district?.id || '',
        name: adapt(citizenDistrictName),
      },
      neighborhood: {
        id: citizen?.neighborhood?.id || '',
        name: adapt(citizenNeighborhoodName),
        tracking_id: citizen?.neighborhood?.tracking_id || '',
      },
      // Eski .docx shablonlar (`{{citizen.mahalla.name}}`) bilan moslik uchun alias
      mahalla: {
        id: citizen?.neighborhood?.id || '',
        name: adapt(citizenNeighborhoodName),
        tracking_id: citizen?.neighborhood?.tracking_id || '',
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

    // ------------------------------------------------------------------------
    // Model 2: Application (Ariza)
    // ------------------------------------------------------------------------
    application: {
      id: application.id || '',
      application_number: application.application_number || 'YANGI',
      date: formatDateUzbek(application.date || application.created_at, script),
      description: adapt(application.description || ''),
      officer_notes: adapt(application.officer_notes || ''),
      status: adapt(appStatus?.name || application.status || ''),
      status_id: application.status_id || '',
      application_status: {
        name: adapt(appStatus?.name || application.status || ''),
        code: appStatus?.code || '',
        description: adapt(appStatus?.description || ''),
        color: appStatus?.color || '',
      },
      created_at: formatDateUzbek(application.created_at, script),
      updated_at: formatDateUzbek(application.updated_at, script),
      appeal_type: adapt(
        APPEAL_TYPE_LABELS[application.appeal_type || AppealType.APPEAL] || 'Ariza',
      ),
      submission_form: adapt(
        SUBMISSION_FORM_LABELS[application.submission_form || SubmissionForm.WRITTEN] || 'Yozma',
      ),
      applicant_type: adapt(
        APPLICANT_TYPE_LABELS[application.applicant_type || ApplicantType.INDIVIDUAL] ||
          'Yakka tartibdagi',
      ),
      repeat_type: adapt(
        REPEAT_TYPE_LABELS[application.repeat_type || ApplicationRepeatType.PRIMARY] || 'Birlamchi',
      ),
      repeat_sequence: String(application.repeat_sequence || 1),
      repeat_reason: adapt(application.repeat_reason || ''),
      parent_number: application.parent_application?.application_number || '',
      root_number: application.root_application?.application_number || '',
      awareness_status: adapt(application.awareness_status?.name || ''),
      awareness_note: adapt(application.awareness_note || ''),
      suspect_details: adapt(suspectDetailsStr),
      suspect_tree_summary: adapt(suspectSummaryStr),
    },

    // ------------------------------------------------------------------------
    // Model 3: Crime (Jinoyat turi)
    // ------------------------------------------------------------------------
    crime: {
      id: crime?.id || '',
      article: adapt(formatTitleCase(crime?.article || crime?.title || 'Firibgarlik')),
      title: adapt(formatTitleCase(crime?.title || crime?.article || 'Firibgarlik')),
      category: adapt(crime?.category || ''),
      gravity: adapt(crime?.gravity || ''),
      description: adapt(crime?.description || crime?.title || ''),
      method: adapt(application.crime_method?.name || ''),
      method_group: adapt(application.crime_method?.group_name || ''),
    },

    // ------------------------------------------------------------------------
    // Model 4: District (Tuman / Bo'lim)
    // ------------------------------------------------------------------------
    district: {
      id: district?.id || citizen?.district?.id || '',
      name: adapt(district?.name || citizenDistrictName || ''),
    },

    // ------------------------------------------------------------------------
    // Model 5: Victim Card (Jabrlanuvchi kartasi)
    // ------------------------------------------------------------------------
    victim_card: {
      id: victimCard?.id || '',
      card_number: formatCardSpaced(victimCard?.card_number),
      masked_number: maskCard(victimCard?.card_number),
      expire_date: victimCard?.expire_date || '',
      full_name: adapt(formatUzbekName(victimCard?.full_name) || cFullName),
      bank: {
        id: victimCard?.bank?.id || '',
        name: adapt(victimCard?.bank?.name || ''),
        code: victimCard?.bank?.code || '',
        mfo: victimCard?.bank?.mfo || '',
      },
      // Aliases
      number: formatCardSpaced(victimCard?.card_number),
      holder: adapt(formatUzbekName(victimCard?.full_name) || cFullName),
    },

    // ------------------------------------------------------------------------
    // Model 6: Fraud Card (Firibgar / Tranzit karta)
    // ------------------------------------------------------------------------
    fraud_card: {
      id: fraudCard?.id || '',
      card_number: formatCardSpaced(fraudCard?.card_number),
      masked_number: maskCard(fraudCard?.card_number),
      expire_date: fraudCard?.expire_date || '',
      full_name: adapt(formatUzbekName(fraudCard?.full_name || '')),
      bank: {
        id: fraudCard?.bank?.id || '',
        name: adapt(fraudCard?.bank?.name || ''),
        code: fraudCard?.bank?.code || '',
        mfo: fraudCard?.bank?.mfo || '',
      },
      // Aliases
      number: formatCardSpaced(fraudCard?.card_number),
      holder: adapt(formatUzbekName(fraudCard?.full_name || '')),
    },

    // ------------------------------------------------------------------------
    // Model 6b: Suspect / Gumonlanuvchi ma'lumotlari
    // ------------------------------------------------------------------------
    suspect: {
      details: adapt(suspectDetailsStr),
      summary: adapt(suspectDetailsStr),
      usernames: adapt(suspectUsernamesStr),
      phones: adapt(suspectPhonesStr),
      cards: adapt(suspectCardsStr),
      raw_summary: adapt(suspectSummaryStr),
      count: finalSuspectList.length,
      ...suspectKeyValues,
    },
    suspect_list: finalSuspectList,
    suspect_tree: finalSuspectList,
    suspect_details: adapt(suspectDetailsStr),

    // ------------------------------------------------------------------------
    // Model 7: Transfer (Asosiy / Birlamchi to'lov o'tkazmasi)
    // ------------------------------------------------------------------------
    transfer: primaryTransferContext,

    // ------------------------------------------------------------------------
    // Model 8: Transfers List (Barcha o'tkazmalar jadvali/loop)
    // ------------------------------------------------------------------------
    transfers: formattedTransfers,

    // ------------------------------------------------------------------------
    // Model 9: Dynamic Custom Fields (Arizaning maxsus maydonlari)
    // ------------------------------------------------------------------------
    custom: customFieldsContext,
    custom_fields: customFieldsContext,

    // ------------------------------------------------------------------------
    // Model 10: Officer (Mas'ul xodim / Tergovchi)
    // ------------------------------------------------------------------------
    officer: {
      id: officerUser?.id || '',
      first_name: adapt(officerFirstName),
      last_name: adapt(officerLastName),
      phone_number: officerUser?.phone_number || '',
      position: adapt(officerPosition),
      username: officerUser?.auth?.username || '',
      role: officerUser?.auth?.role || '',
      // Aliases
      full_name: adapt(officerFullName),
      phone: officerUser?.phone_number || '',
    },

    // ------------------------------------------------------------------------
    // Model 11: Head of Department (Boshqarma boshlig'i)
    // ------------------------------------------------------------------------
    head: {
      title: headTitle,
      position_and_name: headTitle,
    },

    // ------------------------------------------------------------------------
    // Aggregates & System Dates
    // ------------------------------------------------------------------------
    total_stolen_amount: formatAmountNumber(totalStolenAmountNumber),
    total_stolen_amount_words: numberToWordsUz(totalStolenAmountNumber, script),
    total_amount: formatAmountNumber(totalStolenAmountNumber),
    total_amount_words: numberToWordsUz(totalStolenAmountNumber, script),
    current_date: currentDateFormatted,
    current_date_text: currentDateText,
    current_year: String(now.getFullYear()),

    // Backwards compatibility alias for app.*
    app: {
      number: application.application_number || 'YANGI',
      created_date: formatDateUzbek(application.date || application.created_at, script),
      crime_article:
        crime?.article || crime?.title ? `${crime.article || crime.title}`.trim() : 'Firibgarlik',
      district: adapt(district?.name || ''),
      stolen_amount: formatAmountNumber(totalStolenAmountNumber),
      stolen_amount_words: numberToWordsUz(totalStolenAmountNumber, script),
      description: adapt(application.description || ''),
      status: adapt(appStatus?.name || application.status || ''),
    },

    // Flat legacy aliases
    crime_method: adapt(application.crime_method?.name || ''),
    crime_method_group: adapt(application.crime_method?.group_name || ''),
    citizenFullName: adapt(cFullName),
    citizenShortName: adapt(cShortName),
    citizenAddress: adapt(citizenFullAddress),
    citizenPhone: citizen?.phone_number || '',
    citizenBirthDate: adapt(citizenBirthDateText),
    cardNumber: formatCardSpaced(victimCard?.card_number),
    fraudCardNumber: formatCardSpaced(fraudCard?.card_number),
    stolenAmount: formatAmountNumber(totalStolenAmountNumber),
    stolenAmountWords: numberToWordsUz(totalStolenAmountNumber, script),
    officerName: adapt(officerFullName),
    officerPosition: adapt(officerPosition),
    dateText: currentDateText,
  };

  return context;
}
