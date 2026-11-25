import {
  APPEAL_TYPE_LABELS,
  AppealType,
  APPLICANT_TYPE_LABELS,
  ApplicantType,
  ApplicationRepeatType,
  REPEAT_TYPE_LABELS,
  SUBMISSION_FORM_LABELS,
  SubmissionForm,
} from '../../../common/enums/appeal-classification.enum';
import {
  APPLICATION_DAMAGE_TYPE_LABELS,
  ApplicationDamageType,
} from '../../../common/enums/damage-type.enum';
import { TransferDestinationType } from '../../../common/enums/transfer-destination-type.enum';
import { DESTINATION_TYPE_LABELS } from '../../../common/utils/excel-style.util';
import { cyrillicToLatinNormalized } from '../../../common/utils/uzbek-latin.util';

export const IMPORT_TEMPLATE_SIGNATURE = 'UVD_APP_IMPORT_V1';
export const IMPORT_SAMPLE_ROW_MARKER = '[NAMUNA]';
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const SHEET_NAMES = {
  APPLICATIONS: '1. Arizalar',
  EXTRA_TRANSFERS: "2. Qo'shimcha o'tkazmalar",
  SUSPECT_CLUES: '3. Gumonlanuvchi izlari',
  NON_CARD_DAMAGES: '4. Kartasiz zararlar',
  GUIDE: "5. Yo'riqnoma va Enumlar",
  LISTS: '_Royxatlar',
} as const;

export const ERROR_REASON_HEADER = 'Xatolik sababi';

export type ImportDropdownKey =
  | 'statuses'
  | 'districts'
  | 'sources'
  | 'department_services'
  | 'appeal_types'
  | 'submission_forms'
  | 'applicant_types'
  | 'repeat_types'
  | 'crimes'
  | 'crime_methods'
  | 'awareness_statuses'
  | 'genders'
  | 'neighborhoods'
  | 'occupation_categories'
  | 'occupations'
  | 'workplaces'
  | 'banks'
  | 'currencies'
  | 'payment_providers'
  | 'destination_types'
  | 'decision_types'
  | 'rejection_reasons'
  | 'suspect_fields'
  | 'damage_types';

export interface ImportColumnDef {
  key: string;
  header: string;
  width: number;
  group: 'core' | 'classification' | 'citizen' | 'finance' | 'decision' | 'notes';
  required?: boolean;
  dropdownKey?: ImportDropdownKey;
  isTextFormat?: boolean;
  sampleValue?: string | number | null;
}

export const GENDER_LABELS: Record<'male' | 'female', string> = {
  male: 'Erkak',
  female: 'Ayol',
};

export const ALLOWED_CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB'] as const;
export type ImportCurrency = (typeof ALLOWED_CURRENCIES)[number];

export const ALLOWED_DESTINATION_TYPES: TransferDestinationType[] = [
  TransferDestinationType.CARD,
  TransferDestinationType.CRYPTO,
  TransferDestinationType.CASH,
  TransferDestinationType.PLATFORM,
  TransferDestinationType.BANK_ACCOUNT,
  TransferDestinationType.OTHER,
];

export const APP_IMPORT_COLUMNS: ImportColumnDef[] = [
  // =========================================================================
  // 1-BLOK (A–H): E-material asosiy ma'lumotlari (Kunlik reestr A–H ketma-ketligi)
  // =========================================================================
  {
    key: 'link_code',
    header: "Bog'lash kodi (№)",
    width: 16,
    group: 'core',
    isTextFormat: true,
    sampleValue: IMPORT_SAMPLE_ROW_MARKER,
  },
  {
    key: 'source',
    header: 'Murojaat manbasi',
    width: 20,
    group: 'core',
    dropdownKey: 'sources',
  },
  {
    key: 'e_material_officer',
    header: 'E-material ijrochisi',
    width: 26,
    group: 'core',
    sampleValue: '',
  },
  {
    key: 'date',
    header: 'Ariza sanasi *',
    width: 15,
    group: 'core',
    required: true,
    isTextFormat: true,
    sampleValue: '2026-11-25',
  },
  {
    key: 'district',
    header: 'Tuman (Ariza hududi) *',
    width: 22,
    group: 'core',
    required: true,
    dropdownKey: 'districts',
  },
  {
    key: 'application_number',
    header: 'Ariza raqami (E-material №)',
    width: 24,
    group: 'core',
    isTextFormat: true,
    sampleValue: 'M0110224/2026-00001',
  },
  {
    key: 'citizen_full_name',
    header: 'Arizachi (F.I.SH) *',
    width: 32,
    group: 'citizen',
    required: true,
    sampleValue: "Aliyev Vali Akram o'g'li",
  },
  {
    key: 'description',
    header: 'Fabula (Voqea bayoni) *',
    width: 44,
    group: 'notes',
    sampleValue: 'Telegram orqali soxta havola yuborib, plastik kartadan pul yechib olingan.',
  },

  // =========================================================================
  // 2-BLOK (I–O): Jinoyat va asosiy pul o'tkazmasi (Kunlik reestr I–O)
  // =========================================================================
  {
    key: 'crime',
    header: 'Jinoyat turi / moddasi *',
    width: 26,
    group: 'classification',
    dropdownKey: 'crimes',
  },
  {
    key: 'transfer_amount',
    header: "Zarar / O'tkazma summasi",
    width: 20,
    group: 'finance',
    sampleValue: 1500000,
  },
  {
    key: 'crime_method',
    header: 'Jinoyat sodir etish usuli',
    width: 36,
    group: 'classification',
    dropdownKey: 'crime_methods',
  },
  {
    key: 'officer_notes',
    header: "Qo'shimcha izoh (Xodim qaydlari)",
    width: 34,
    group: 'notes',
    sampleValue: '',
  },
  {
    key: 'victim_card_number',
    header: 'Jabrlanuvchi karta raqami',
    width: 22,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '8600123456789012',
  },
  {
    key: 'victim_card_bank',
    header: 'Jabrlanuvchi karta banki',
    width: 22,
    group: 'finance',
    dropdownKey: 'banks',
  },
  {
    key: 'payment_provider',
    header: "To'lov provayderi (Ilova)",
    width: 22,
    group: 'finance',
    dropdownKey: 'payment_providers',
  },

  // =========================================================================
  // 3-BLOK (P–V): Arizachi shaxsiy ma'lumotlari (Kunlik reestr P–V)
  // =========================================================================
  {
    key: 'citizen_phone',
    header: 'Telefon raqami **',
    width: 19,
    group: 'citizen',
    isTextFormat: true,
    sampleValue: '+998901234567',
  },
  {
    key: 'citizen_birth_date',
    header: "Tug'ilgan sanasi",
    width: 16,
    group: 'citizen',
    isTextFormat: true,
    sampleValue: '1991-05-14',
  },
  {
    key: 'citizen_gender',
    header: 'Jinsi (Enum)',
    width: 14,
    group: 'citizen',
    dropdownKey: 'genders',
    sampleValue: GENDER_LABELS.male,
  },
  {
    key: 'citizen_district',
    header: 'Yashash tumani',
    width: 22,
    group: 'citizen',
    dropdownKey: 'districts',
  },
  {
    key: 'citizen_neighborhood',
    header: 'Yashash mahallasi (MFY)',
    width: 30,
    group: 'citizen',
    dropdownKey: 'neighborhoods',
  },
  {
    key: 'occupation',
    header: 'Kasb turi',
    width: 28,
    group: 'citizen',
    dropdownKey: 'occupations',
  },
  {
    key: 'workplace',
    header: 'Ish joyi / Tashkilot',
    width: 32,
    group: 'citizen',
    dropdownKey: 'workplaces',
  },

  // =========================================================================
  // 4-BLOK (W–Y): Firibgar kartasi va Targ'ibot (Kunlik reestr W–Y)
  // =========================================================================
  {
    key: 'receiver_card_number',
    header: 'Qabul qiluvchi (Firibgar) karta',
    width: 24,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '9860987654321098',
  },
  {
    key: 'receiver_card_bank',
    header: 'Firibgar karta banki',
    width: 22,
    group: 'finance',
    dropdownKey: 'banks',
  },
  {
    key: 'awareness_status',
    header: "Targ'ibot holati",
    width: 32,
    group: 'classification',
    dropdownKey: 'awareness_statuses',
  },

  // =========================================================================
  // 5-BLOK (Z–AZ): Qo'shimcha tizim rekvizitlari (Ixtiyoriy)
  // =========================================================================
  {
    key: 'repeat_type',
    header: 'Takroriylik turi (Enum)',
    width: 20,
    group: 'classification',
    dropdownKey: 'repeat_types',
    sampleValue: REPEAT_TYPE_LABELS[ApplicationRepeatType.PRIMARY],
  },
  {
    key: 'parent_application_number',
    header: 'Avvalgi ariza raqami',
    width: 22,
    group: 'classification',
    isTextFormat: true,
    sampleValue: '',
  },
  {
    key: 'repeat_reason',
    header: 'Takroriylik sababi',
    width: 24,
    group: 'classification',
    sampleValue: '',
  },
  {
    key: 'status',
    header: 'Ariza holati (Status)',
    width: 24,
    group: 'core',
    dropdownKey: 'statuses',
  },
  {
    key: 'decision_type',
    header: 'Yakuniy qaror turi',
    width: 26,
    group: 'decision',
    dropdownKey: 'decision_types',
  },
  {
    key: 'decision_number',
    header: 'Qaror raqami',
    width: 18,
    group: 'decision',
    isTextFormat: true,
    sampleValue: '',
  },
  {
    key: 'decision_date',
    header: 'Qaror sanasi',
    width: 15,
    group: 'decision',
    isTextFormat: true,
    sampleValue: '',
  },
  {
    key: 'rejection_reason',
    header: 'Rad etish sababi',
    width: 26,
    group: 'decision',
    dropdownKey: 'rejection_reasons',
  },
  {
    key: 'department_service',
    header: 'Sohaviy xizmat',
    width: 24,
    group: 'core',
    dropdownKey: 'department_services',
  },
  {
    key: 'appeal_type',
    header: 'Murojaat turi (Enum)',
    width: 18,
    group: 'classification',
    dropdownKey: 'appeal_types',
    sampleValue: APPEAL_TYPE_LABELS[AppealType.APPEAL],
  },
  {
    key: 'submission_form',
    header: 'Murojaat shakli (Enum)',
    width: 20,
    group: 'classification',
    dropdownKey: 'submission_forms',
    sampleValue: SUBMISSION_FORM_LABELS[SubmissionForm.WRITTEN],
  },
  {
    key: 'applicant_type',
    header: 'Murojaatchi turi (Enum)',
    width: 24,
    group: 'classification',
    dropdownKey: 'applicant_types',
    sampleValue: APPLICANT_TYPE_LABELS[ApplicantType.INDIVIDUAL],
  },
  {
    key: 'awareness_note',
    header: "Targ'ibot izohi",
    width: 26,
    group: 'classification',
    sampleValue: '',
  },
  {
    key: 'citizen_passport',
    header: 'Pasport seriya/raqami **',
    width: 20,
    group: 'citizen',
    isTextFormat: true,
    sampleValue: 'AB1234567',
  },
  {
    key: 'citizen_pinfl',
    header: 'JSHSHIR (PINFL) **',
    width: 19,
    group: 'citizen',
    isTextFormat: true,
    sampleValue: '31405911234567',
  },
  {
    key: 'citizen_address',
    header: "Yashash manzili (Ko'cha/Uy)",
    width: 28,
    group: 'citizen',
    sampleValue: "Mustaqillik ko'chasi, 12-uy",
  },
  {
    key: 'occupation_category',
    header: 'Kasb toifasi',
    width: 24,
    group: 'citizen',
    dropdownKey: 'occupation_categories',
  },
  {
    key: 'work_position',
    header: 'Lavozimi',
    width: 22,
    group: 'citizen',
    sampleValue: 'Mutaxassis',
  },
  {
    key: 'victim_card_full_name',
    header: 'Jabrlanuvchi karta egasi',
    width: 24,
    group: 'finance',
    sampleValue: 'Aliyev Vali',
  },
  {
    key: 'transfer_currency',
    header: 'Valyuta (Enum)',
    width: 14,
    group: 'finance',
    dropdownKey: 'currencies',
    sampleValue: 'UZS',
  },
  {
    key: 'destination_type',
    header: 'Chiqish kanali turi (Enum)',
    width: 24,
    group: 'finance',
    dropdownKey: 'destination_types',
    sampleValue: DESTINATION_TYPE_LABELS[TransferDestinationType.CARD],
  },
  {
    key: 'receiver_card_full_name',
    header: 'Firibgar karta egasi',
    width: 24,
    group: 'finance',
    sampleValue: 'Nomalum Shaxs',
  },
  {
    key: 'destination_label',
    header: 'Chiqish manzili (Kripto/Platforma/Hisob)',
    width: 30,
    group: 'finance',
    sampleValue: '',
  },
  {
    key: 'transfer_date',
    header: "O'tkazma sanasi",
    width: 16,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '2026-11-24',
  },
  {
    key: 'transfer_time',
    header: "O'tkazma vaqti",
    width: 14,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '14:30',
  },
  {
    key: 'transaction_id',
    header: 'Tranzaksiya ID',
    width: 22,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '',
  },
  {
    key: 'sla_days',
    header: 'Protsessual muddat (SLA kun)',
    width: 22,
    group: 'decision',
    sampleValue: 10,
  },
];

export const EXTRA_TRANSFER_IMPORT_COLUMNS: ImportColumnDef[] = [
  {
    key: 'app_ref',
    header: "Ariza bog'lash kodi / Ariza № *",
    width: 26,
    group: 'core',
    required: true,
    isTextFormat: true,
    sampleValue: IMPORT_SAMPLE_ROW_MARKER,
  },
  {
    key: 'victim_card_number',
    header: 'Jabrlanuvchi karta raqami',
    width: 22,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '8600123456789012',
  },
  {
    key: 'victim_card_bank',
    header: 'Jabrlanuvchi karta banki',
    width: 22,
    group: 'finance',
    dropdownKey: 'banks',
  },
  {
    key: 'amount',
    header: "O'tkazma summasi *",
    width: 20,
    group: 'finance',
    required: true,
    sampleValue: 500000,
  },
  {
    key: 'currency',
    header: 'Valyuta (Enum)',
    width: 14,
    group: 'finance',
    dropdownKey: 'currencies',
    sampleValue: 'UZS',
  },
  {
    key: 'payment_provider',
    header: "To'lov provayderi",
    width: 20,
    group: 'finance',
    dropdownKey: 'payment_providers',
  },
  {
    key: 'destination_type',
    header: 'Chiqish kanali turi (Enum)',
    width: 24,
    group: 'finance',
    dropdownKey: 'destination_types',
    sampleValue: DESTINATION_TYPE_LABELS[TransferDestinationType.CARD],
  },
  {
    key: 'receiver_card_number',
    header: 'Qabul qiluvchi (Firibgar) karta',
    width: 24,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '9860111122223333',
  },
  {
    key: 'receiver_card_bank',
    header: 'Firibgar karta banki',
    width: 22,
    group: 'finance',
    dropdownKey: 'banks',
  },
  {
    key: 'receiver_card_full_name',
    header: 'Firibgar karta egasi',
    width: 24,
    group: 'finance',
    sampleValue: '',
  },
  {
    key: 'destination_label',
    header: 'Chiqish manzili (Kripto/Platforma)',
    width: 30,
    group: 'finance',
    sampleValue: '',
  },
  {
    key: 'transfer_date',
    header: "O'tkazma sanasi",
    width: 16,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '2026-11-24',
  },
  {
    key: 'transfer_time',
    header: "O'tkazma vaqti",
    width: 14,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '15:10',
  },
  {
    key: 'transaction_id',
    header: 'Tranzaksiya ID',
    width: 22,
    group: 'finance',
    isTextFormat: true,
    sampleValue: '',
  },
];

export const SUSPECT_CLUE_IMPORT_COLUMNS: ImportColumnDef[] = [
  {
    key: 'app_ref',
    header: "Ariza bog'lash kodi / Ariza № *",
    width: 26,
    group: 'core',
    required: true,
    isTextFormat: true,
    sampleValue: IMPORT_SAMPLE_ROW_MARKER,
  },
  {
    key: 'field_type',
    header: 'Iz turi (Katalog) *',
    width: 28,
    group: 'classification',
    required: true,
    dropdownKey: 'suspect_fields',
  },
  {
    key: 'value',
    header: 'Qiymati *',
    width: 32,
    group: 'notes',
    required: true,
    isTextFormat: true,
    sampleValue: '@fraudster_example',
  },
  {
    key: 'note',
    header: 'Izoh',
    width: 34,
    group: 'notes',
    sampleValue: 'Jabrlanuvchiga yozgan Telegram akkaunti',
  },
];

export const NON_CARD_DAMAGE_IMPORT_COLUMNS: ImportColumnDef[] = [
  {
    key: 'app_ref',
    header: "Ariza bog'lash kodi / Ariza № *",
    width: 26,
    group: 'core',
    required: true,
    isTextFormat: true,
    sampleValue: IMPORT_SAMPLE_ROW_MARKER,
  },
  {
    key: 'damage_type',
    header: 'Zarar turi (Enum) *',
    width: 28,
    group: 'classification',
    required: true,
    dropdownKey: 'damage_types',
    sampleValue: APPLICATION_DAMAGE_TYPE_LABELS[ApplicationDamageType.INSTALLMENT],
  },
  {
    key: 'organization_name',
    header: 'Tashkilot / Platforma',
    width: 26,
    group: 'finance',
    sampleValue: 'Uzum Nasiya',
  },
  {
    key: 'amount',
    header: 'Zarar summasi *',
    width: 20,
    group: 'finance',
    required: true,
    sampleValue: 12500000,
  },
  {
    key: 'currency',
    header: 'Valyuta (Enum)',
    width: 14,
    group: 'finance',
    dropdownKey: 'currencies',
    sampleValue: 'UZS',
  },
  {
    key: 'contract_number',
    header: 'Shartnoma / Buyurtma №',
    width: 22,
    group: 'core',
    isTextFormat: true,
    sampleValue: 'UZN-2026-12345',
  },
  {
    key: 'damage_date',
    header: 'Sana',
    width: 15,
    group: 'core',
    isTextFormat: true,
    sampleValue: '2026-11-24',
  },
  {
    key: 'description',
    header: 'Tafsilot (Nima olingani)',
    width: 38,
    group: 'notes',
    sampleValue: 'Fuqaro nomiga iPhone 15 Pro 12 oyga nasiyaga rasmiylashtirilgan',
  },
];

export function normalizeLookupKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return cyrillicToLatinNormalized(String(raw)).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeHeaderKey(raw: string | null | undefined): string {
  return normalizeLookupKey(raw).replace(/[*]+/g, '').replace(/\s+/g, ' ').trim();
}

export type ImportRowStatus = 'READY' | 'DUPLICATE' | 'ERROR';

export interface ImportCellError {
  sheet: 'APPLICATIONS' | 'EXTRA_TRANSFERS' | 'SUSPECT_CLUES' | 'NON_CARD_DAMAGES';
  rowNumber: number;
  columnKey: string;
  message: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  linkCode: string | null;
  applicationNumber: string | null;
  date: string | null;
  districtName: string | null;
  citizenFullName: string | null;
  citizenIdentifier: string | null;
  crimeLabel: string | null;
  totalAmount: number;
  currency: string;
  transfersCount: number;
  suspectCluesCount: number;
  status: ImportRowStatus;
  duplicateReason?: string | null;
  matchedExistingCitizen?: boolean;
  matchedExistingCards?: string[];
  errors: string[];
  cellErrors: ImportCellError[];
  warnings: string[];
}

export interface ImportOrphanRowError {
  sheet: 'EXTRA_TRANSFERS' | 'SUSPECT_CLUES' | 'NON_CARD_DAMAGES';
  rowNumber: number;
  appRef: string | null;
  message: string;
  columnKey: string;
}

export interface ImportPreviewResponse {
  templateValid: boolean;
  totalRows: number;
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
  orphanErrorsCount: number;
  ignoredExtraColumns: string[];
  rows: ImportPreviewRow[];
  orphanErrors: ImportOrphanRowError[];
}

export interface ImportCommitResponse {
  totalRows: number;
  createdCount: number;
  skippedDuplicateCount: number;
  failedCount: number;
  createdApplications: Array<{
    id: string;
    rowNumber: number;
    application_number: string | null;
    citizen_name: string | null;
  }>;
  skippedDuplicates: Array<{
    rowNumber: number;
    application_number: string | null;
    reason: string;
  }>;
  failedRows: Array<{
    rowNumber: number;
    application_number: string | null;
    errors: string[];
  }>;
  errorReportBase64: string | null;
  errorReportFileName: string | null;
}

export interface FailedRowExportPayload {
  applications: Array<{
    rawValues: Record<string, string | number | null>;
    cellErrors: Map<string, string[]>;
    rowErrors: string[];
  }>;
  extraTransfers: Array<{
    rawValues: Record<string, string | number | null>;
    cellErrors: Map<string, string[]>;
    rowErrors: string[];
  }>;
  suspectClues: Array<{
    rawValues: Record<string, string | number | null>;
    cellErrors: Map<string, string[]>;
    rowErrors: string[];
  }>;
  nonCardDamages: Array<{
    rawValues: Record<string, string | number | null>;
    cellErrors: Map<string, string[]>;
    rowErrors: string[];
  }>;
}
