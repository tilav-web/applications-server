import * as crypto from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { type EntityManager, In, Repository } from 'typeorm';

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
import { CustomFieldType } from '../../../common/enums/custom-field-type.enum';
import { Role } from '../../../common/enums/role.enum';
import { TransferDestinationType } from '../../../common/enums/transfer-destination-type.enum';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../../common/utils/district-scope.util';
import { DESTINATION_TYPE_LABELS } from '../../../common/utils/excel-style.util';
import { formatUzbekName } from '../../../common/utils/name-formatter.util';
import {
  isPgUniqueViolation,
  normalizeCardNumber,
  normalizePassport,
  normalizePinfl,
  normalizeUzPhone,
} from '../../../common/utils/normalization.util';
import { IntelligenceSyncService } from '../../intelligence/intelligence-sync.service';
import { SlaQueueService } from '../../notifications/sla-queue.service';
import { User } from '../../users/user.entity';
import { Application, type SuspectTreeNode } from '../application.entity';
import { computeNextRepeatSequence, resolveRootApplicationId } from '../application-chain.util';
import { ApplicationStatusHistory } from '../application-status-history.entity';
import { AwarenessStatus } from '../awareness-statuses/awareness-status.entity';
import { Citizen } from '../citizens/citizen.entity';
import { Crime } from '../crimes/crime.entity';
import { CrimeMethod } from '../crimes/methods/crime-method.entity';
import { ApplicationCustomField } from '../custom-fields/application-custom-field.entity';
import { DecisionType } from '../decision-types/decision-type.entity';
import { DepartmentService } from '../department-services/department-service.entity';
import { District } from '../districts/district.entity';
import { Neighborhood } from '../neighborhoods/neighborhood.entity';
import { Occupation } from '../occupations/occupation.entity';
import { OccupationCategory } from '../occupations/occupation-category.entity';
import { RejectionReason } from '../rejection-reasons/rejection-reason.entity';
import { ApplicationSource } from '../sources/application-source.entity';
import {
  ApplicationStatus as ApplicationStatusEntity,
  ApplicationStatusCategory,
} from '../statuses/application-status.entity';
import { SuspectFieldConfig } from '../suspect-fields/suspect-field-config.entity';
import { Bank } from '../transfers/banks/bank.entity';
import { Card } from '../transfers/cards/card.entity';
import { PaymentProvider } from '../transfers/payment_providers/payment_provider.entity';
import { Transfer } from '../transfers/transfer.entity';
import { Workplace } from '../workplaces/workplace.entity';
import {
  ALLOWED_CURRENCIES,
  ALLOWED_DESTINATION_TYPES,
  APP_IMPORT_COLUMNS,
  ERROR_REASON_HEADER,
  EXTRA_TRANSFER_IMPORT_COLUMNS,
  type FailedRowExportPayload,
  GENDER_LABELS,
  IMPORT_MAX_ROWS,
  IMPORT_SAMPLE_ROW_MARKER,
  IMPORT_TEMPLATE_SIGNATURE,
  type ImportCellError,
  type ImportColumnDef,
  type ImportCommitResponse,
  type ImportOrphanRowError,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ImportRowStatus,
  normalizeHeaderKey,
  normalizeLookupKey,
  SHEET_NAMES,
  SUSPECT_CLUE_IMPORT_COLUMNS,
} from './applications-import.types';
import { ApplicationsImportTemplateService } from './applications-import-template.service';

interface ParsedExtraTransferRow {
  rowNumber: number;
  appRef: string;
  rawValues: Record<string, string | number | null>;
  victimCardNumber: string | null;
  victimBankId: string | null;
  amount: number | null;
  currency: string;
  paymentProviderId: string | null;
  destinationType: TransferDestinationType;
  receiverCardNumber: string | null;
  receiverBankId: string | null;
  receiverCardFullName: string | null;
  destinationLabel: string | null;
  transferDate: string | null;
  transferTime: string | null;
  transactionId: string | null;
  cellErrors: Map<string, string[]>;
  errors: string[];
}

interface ParsedSuspectClueRow {
  rowNumber: number;
  appRef: string;
  rawValues: Record<string, string | number | null>;
  fieldKey: string | null;
  fieldLabel: string | null;
  value: string | null;
  note: string | null;
  cellErrors: Map<string, string[]>;
  errors: string[];
}

interface ParsedApplicationRow {
  rowNumber: number;
  linkCode: string | null;
  rawValues: Record<string, string | number | null>;
  applicationNumber: string | null;
  date: string | null;
  statusId: string | null;
  statusCode: string | null;
  statusObj: ApplicationStatusEntity | null;
  districtId: string | null;
  districtName: string | null;
  sourceId: string | null;
  departmentServiceId: string | null;
  appealType: AppealType;
  submissionForm: SubmissionForm;
  applicantType: ApplicantType;
  repeatType: ApplicationRepeatType;
  parentApplicationNumber: string | null;
  parentApplicationId: string | null;
  repeatReason: string | null;
  crimeId: string | null;
  crimeLabel: string | null;
  crimeMethodId: string | null;
  awarenessStatusId: string | null;
  awarenessNote: string | null;
  citizenLastName: string | null;
  citizenFirstName: string | null;
  citizenMiddleName: string | null;
  citizenGender: 'male' | 'female' | null;
  citizenBirthDate: string | null;
  citizenPhone: string | null;
  citizenPassport: string | null;
  citizenPinfl: string | null;
  citizenDistrictId: string | null;
  citizenNeighborhoodId: string | null;
  citizenAddress: string | null;
  occupationCategoryId: string | null;
  occupationId: string | null;
  workplaceId: string | null;
  workPosition: string | null;
  victimCardNumber: string | null;
  victimBankId: string | null;
  victimCardFullName: string | null;
  transferAmount: number | null;
  transferCurrency: string;
  paymentProviderId: string | null;
  destinationType: TransferDestinationType;
  receiverCardNumber: string | null;
  receiverBankId: string | null;
  receiverCardFullName: string | null;
  destinationLabel: string | null;
  transferDate: string | null;
  transferTime: string | null;
  transactionId: string | null;
  slaDays: number | null;
  decisionTypeId: string | null;
  decisionNumber: string | null;
  decisionDate: string | null;
  rejectionReasonId: string | null;
  description: string | null;
  officerNotes: string | null;
  extraTransfers: ParsedExtraTransferRow[];
  suspectClues: ParsedSuspectClueRow[];
  matchedCitizenId: string | null;
  matchedCards: string[];
  status: ImportRowStatus;
  duplicateReason: string | null;
  cellErrors: Map<string, string[]>;
  errors: string[];
  warnings: string[];
}

interface ParsedWorkbookAnalysis {
  templateValid: boolean;
  creatorUserId: string | null;
  allowedDistrictIds: string[] | null;
  ignoredExtraColumns: string[];
  rows: ParsedApplicationRow[];
  orphanTransfers: ParsedExtraTransferRow[];
  orphanSuspects: ParsedSuspectClueRow[];
}

interface ReferenceCatalog {
  districtsByKey: Map<string, District>;
  districtsById: Map<string, District>;
  neighborhoodsByDistrictAndName: Map<string, Neighborhood>;
  neighborhoodsByFullLabel: Map<string, Neighborhood>;
  statusesByKey: Map<string, ApplicationStatusEntity>;
  defaultStatus: ApplicationStatusEntity | null;
  crimesByKey: Map<string, Crime>;
  crimeMethodsByKey: Map<string, CrimeMethod>;
  sourcesByKey: Map<string, ApplicationSource>;
  deptServicesByKey: Map<string, DepartmentService>;
  awarenessByKey: Map<string, AwarenessStatus>;
  occCategoriesByKey: Map<string, OccupationCategory>;
  occupationsByCatAndName: Map<string, Occupation>;
  occupationsByFullLabel: Map<string, Occupation>;
  occupationsByName: Map<string, Occupation[]>;
  workplacesByDistrictAndName: Map<string, Workplace>;
  workplacesByFullLabel: Map<string, Workplace>;
  workplacesByName: Map<string, Workplace[]>;
  banksByKey: Map<string, Bank>;
  providersByKey: Map<string, PaymentProvider>;
  decisionTypesByKey: Map<string, DecisionType>;
  rejectionReasonsByKey: Map<string, RejectionReason>;
  suspectFieldsByKey: Map<string, SuspectFieldConfig>;
}

const APPEAL_TYPE_LOOKUP = buildEnumLookup<AppealType>(APPEAL_TYPE_LABELS);
const SUBMISSION_FORM_LOOKUP = buildEnumLookup<SubmissionForm>(SUBMISSION_FORM_LABELS);
const APPLICANT_TYPE_LOOKUP = buildEnumLookup<ApplicantType>(APPLICANT_TYPE_LABELS);
const REPEAT_TYPE_LOOKUP = buildEnumLookup<ApplicationRepeatType>(REPEAT_TYPE_LABELS);
const GENDER_LOOKUP = new Map<string, 'male' | 'female'>([
  [normalizeLookupKey(GENDER_LABELS.male), 'male'],
  ['male', 'male'],
  ['m', 'male'],
  ['erkak', 'male'],
  [normalizeLookupKey(GENDER_LABELS.female), 'female'],
  ['female', 'female'],
  ['f', 'female'],
  ['ayol', 'female'],
]);
const DESTINATION_TYPE_LOOKUP = buildDestinationLookup();
const CURRENCY_SET = new Set<string>(ALLOWED_CURRENCIES);

function buildEnumLookup<T extends string>(labels: Record<T, string>): Map<string, T> {
  const map = new Map<string, T>();
  for (const [code, label] of Object.entries(labels) as Array<[T, string]>) {
    map.set(normalizeLookupKey(code), code);
    map.set(normalizeLookupKey(label), code);
  }
  return map;
}

function buildDestinationLookup(): Map<string, TransferDestinationType> {
  const map = new Map<string, TransferDestinationType>();
  for (const code of ALLOWED_DESTINATION_TYPES) {
    map.set(normalizeLookupKey(code), code);
    const label = DESTINATION_TYPE_LABELS[code];
    if (label) {
      map.set(normalizeLookupKey(label), code);
    }
  }
  map.set('karta', TransferDestinationType.CARD);
  map.set('kripto', TransferDestinationType.CRYPTO);
  map.set('naqd', TransferDestinationType.CASH);
  map.set('platforma', TransferDestinationType.PLATFORM);
  map.set('hisob raqami', TransferDestinationType.BANK_ACCOUNT);
  map.set('boshqa', TransferDestinationType.OTHER);
  return map;
}

@Injectable()
export class ApplicationsImportService {
  private readonly logger = new Logger(ApplicationsImportService.name);

  constructor(
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Citizen)
    private readonly citizenRepo: Repository<Citizen>,
    @InjectRepository(Card)
    private readonly cardRepo: Repository<Card>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    @InjectRepository(Neighborhood)
    private readonly neighborhoodRepo: Repository<Neighborhood>,
    @InjectRepository(ApplicationStatusEntity)
    private readonly statusRepo: Repository<ApplicationStatusEntity>,
    @InjectRepository(Crime)
    private readonly crimeRepo: Repository<Crime>,
    @InjectRepository(CrimeMethod)
    private readonly crimeMethodRepo: Repository<CrimeMethod>,
    @InjectRepository(ApplicationSource)
    private readonly sourceRepo: Repository<ApplicationSource>,
    @InjectRepository(DepartmentService)
    private readonly deptServiceRepo: Repository<DepartmentService>,
    @InjectRepository(AwarenessStatus)
    private readonly awarenessRepo: Repository<AwarenessStatus>,
    @InjectRepository(OccupationCategory)
    private readonly occCategoryRepo: Repository<OccupationCategory>,
    @InjectRepository(Occupation)
    private readonly occupationRepo: Repository<Occupation>,
    @InjectRepository(Workplace)
    private readonly workplaceRepo: Repository<Workplace>,
    @InjectRepository(Bank)
    private readonly bankRepo: Repository<Bank>,
    @InjectRepository(PaymentProvider)
    private readonly providerRepo: Repository<PaymentProvider>,
    @InjectRepository(DecisionType)
    private readonly decisionTypeRepo: Repository<DecisionType>,
    @InjectRepository(RejectionReason)
    private readonly rejectionReasonRepo: Repository<RejectionReason>,
    @InjectRepository(SuspectFieldConfig)
    private readonly suspectFieldRepo: Repository<SuspectFieldConfig>,
    private readonly templateService: ApplicationsImportTemplateService,
    private readonly intelligenceSync: IntelligenceSyncService,
    private readonly slaQueueService: SlaQueueService,
  ) {}

  private assertCanImport(currentUser?: JwtAccessPayload): void {
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException(
        "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
      );
    }
  }

  private addCellError(
    cellErrors: Map<string, string[]>,
    errors: string[],
    columnKey: string,
    message: string,
  ): void {
    const existing = cellErrors.get(columnKey) || [];
    if (!existing.includes(message)) {
      existing.push(message);
      cellErrors.set(columnKey, existing);
    }
    if (!errors.includes(message)) {
      errors.push(message);
    }
  }

  private extractRawCellValue(val: ExcelJS.CellValue): string | number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      let cleaned = val.trim();
      // Qayta yuklangan xatolik hisobotida sanitizeExcelValue qo'shgan yetakchi apostrofni tozalash
      if (cleaned.length > 1 && cleaned.startsWith("'") && /^[=+\-@]/.test(cleaned[1])) {
        cleaned = cleaned.slice(1);
      }
      return cleaned.length > 0 ? cleaned : null;
    }
    if (typeof val === 'number') {
      return Number.isFinite(val) ? val : null;
    }
    if (typeof val === 'boolean') {
      return val ? 'Ha' : "Yo'q";
    }
    if (val instanceof Date) {
      if (Number.isNaN(val.getTime())) return null;
      return this.formatDateUTC(val);
    }
    if (typeof val === 'object') {
      if ('richText' in val && Array.isArray(val.richText)) {
        const text = val.richText
          .map((part) => part.text || '')
          .join('')
          .trim();
        return text.length > 0 ? text : null;
      }
      if ('text' in val && typeof val.text === 'string') {
        const text = val.text.trim();
        return text.length > 0 ? text : null;
      }
      if ('result' in val && val.result !== undefined) {
        return this.extractRawCellValue(val.result);
      }
    }
    return null;
  }

  private extractText(val: ExcelJS.CellValue): string | null {
    const raw = this.extractRawCellValue(val);
    if (raw === null) return null;
    if (typeof raw === 'number') {
      if (Number.isInteger(raw)) {
        return String(raw);
      }
      return String(raw);
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private formatDateUTC(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private parseDateValue(val: ExcelJS.CellValue): { value: string | null; error?: string } {
    if (val === null || val === undefined || val === '') return { value: null };

    if (val instanceof Date) {
      if (Number.isNaN(val.getTime())) {
        return { value: null, error: "Sana formati noto'g'ri" };
      }
      const year = val.getUTCFullYear();
      if (year < 1900 || year > 2100) {
        return { value: null, error: 'Sana yili 1900-2100 oralig‘ida bo‘lishi kerak' };
      }
      return { value: this.formatDateUTC(val) };
    }

    if (typeof val === 'number' && Number.isFinite(val)) {
      // Excel serial date (days since 1899-12-30)
      if (val < 1 || val > 75000) {
        return { value: null, error: "Sana qiymati noto'g'ri (YYYY-MM-DD formatida kiriting)" };
      }
      const epoch = Date.UTC(1899, 11, 30);
      const parsed = new Date(epoch + Math.round(val) * 86400000);
      return { value: this.formatDateUTC(parsed) };
    }

    const str = this.extractText(val);
    if (!str) return { value: null };

    // YYYY-MM-DD
    const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(str);
    if (isoMatch) {
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]);
      const d = Number(isoMatch[3]);
      return this.validateYmd(y, m, d);
    }

    // DD.MM.YYYY or DD/MM/YYYY
    const dmyMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(str);
    if (dmyMatch) {
      const d = Number(dmyMatch[1]);
      const m = Number(dmyMatch[2]);
      const y = Number(dmyMatch[3]);
      return this.validateYmd(y, m, d);
    }

    return {
      value: null,
      error: `«${str}» sana formati noto'g'ri (YYYY-MM-DD yoki DD.MM.YYYY kiriting)`,
    };
  }

  private validateYmd(y: number, m: number, d: number): { value: string | null; error?: string } {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
      return { value: null, error: "Sana qiymati noto'g'ri" };
    }
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      return { value: null, error: `Mavjud bo'lmagan kalendar sanasi (${y}-${m}-${d})` };
    }
    return {
      value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    };
  }

  private parseTimeValue(val: ExcelJS.CellValue): { value: string | null; error?: string } {
    if (val === null || val === undefined || val === '') return { value: null };
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      const hh = String(val.getUTCHours()).padStart(2, '0');
      const mm = String(val.getUTCMinutes()).padStart(2, '0');
      return { value: `${hh}:${mm}` };
    }
    if (typeof val === 'number' && val >= 0 && val < 1) {
      const totalMinutes = Math.round(val * 24 * 60);
      const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
      const mm = String(totalMinutes % 60).padStart(2, '0');
      return { value: `${hh}:${mm}` };
    }
    const str = this.extractText(val);
    if (!str) return { value: null };
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str);
    if (!m) {
      return { value: null, error: `«${str}» vaqt formati noto'g'ri (HH:MM kiriting)` };
    }
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return { value: null, error: `«${str}» vaqt qiymati noto'g'ri` };
    }
    return { value: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
  }

  private parsePositiveNumber(
    val: ExcelJS.CellValue,
    fieldLabel: string,
  ): { value: number | null; error?: string } {
    if (val === null || val === undefined || val === '') return { value: null };
    if (typeof val === 'number') {
      if (!Number.isFinite(val) || val <= 0) {
        return { value: null, error: `${fieldLabel} musbat son bo'lishi kerak` };
      }
      return { value: val };
    }
    const str = this.extractText(val);
    if (!str) return { value: null };
    const cleaned = str
      .replace(/\s+/g, '')
      .replace(/,/g, '.')
      .replace(/so'?m|uzs$/i, '');
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num <= 0) {
      return { value: null, error: `${fieldLabel} («${str}») musbat son bo'lishi kerak` };
    }
    return { value: num };
  }

  private parseCardNumber(val: ExcelJS.CellValue): { value: string | null; error?: string } {
    if (val === null || val === undefined || val === '') return { value: null };
    if (typeof val === 'number') {
      // JS number precision > 2^53 (9007199254740991) bo'lsa 16-raqam buzilgan bo'lishi mumkin
      if (val > 9007199254740991) {
        return {
          value: null,
          error:
            'Karta raqami Excelda son sifatida buzilgan. Ustunni matn (Text) formatida 16 raqam qilib kiriting',
        };
      }
    }
    const str = this.extractText(val);
    if (!str) return { value: null };
    if (/e\+/i.test(str)) {
      return {
        value: null,
        error: "Karta raqami ilmiy formatda (E+) buzilgan. Matn sifatida to'liq 16 raqam kiriting",
      };
    }
    const cleaned = normalizeCardNumber(str);
    if (!cleaned || cleaned.length !== 16) {
      return {
        value: null,
        error: `Karta raqami aniq 16 ta raqamdan iborat bo'lishi kerak (kiritilgan: «${str}»)`,
      };
    }
    return { value: cleaned };
  }

  private buildHeaderMap(
    ws: ExcelJS.Worksheet,
    columns: ImportColumnDef[],
  ): { colIndexByKey: Map<string, number>; ignoredHeaders: string[]; matchedCount: number } {
    const defByNormHeader = new Map<string, ImportColumnDef>();
    for (const col of columns) {
      defByNormHeader.set(normalizeHeaderKey(col.header), col);
      defByNormHeader.set(normalizeHeaderKey(col.key), col);
    }

    const ignoredHelperKey = normalizeHeaderKey(ERROR_REASON_HEADER);
    const colIndexByKey = new Map<string, number>();
    const ignoredHeaders: string[] = [];
    const headerRow = ws.getRow(1);
    const maxCol = Math.min(ws.actualColumnCount || ws.columnCount, 200);

    for (let c = 1; c <= maxCol; c++) {
      const text = this.extractText(headerRow.getCell(c).value);
      if (!text) continue;
      const norm = normalizeHeaderKey(text);
      if (norm === ignoredHelperKey || norm === 'holat') {
        continue;
      }
      const def = defByNormHeader.get(norm);
      if (def && !colIndexByKey.has(def.key)) {
        colIndexByKey.set(def.key, c);
      } else if (!def) {
        ignoredHeaders.push(text);
      }
    }

    return { colIndexByKey, ignoredHeaders, matchedCount: colIndexByKey.size };
  }

  private async loadReferenceCatalog(): Promise<ReferenceCatalog> {
    const [
      districts,
      neighborhoods,
      statuses,
      crimes,
      crimeMethods,
      sources,
      deptServices,
      awarenessList,
      occCategories,
      occupations,
      workplaces,
      banks,
      providers,
      decisionTypes,
      rejectionReasons,
      suspectFields,
    ] = await Promise.all([
      this.districtRepo.find(),
      this.neighborhoodRepo.find({ relations: { district: true } }),
      this.statusRepo.find({ order: { sort_order: 'ASC' } }),
      this.crimeRepo.find(),
      this.crimeMethodRepo.find({ where: { is_active: true } }),
      this.sourceRepo.find({ where: { is_active: true } }),
      this.deptServiceRepo.find({ where: { is_active: true } }),
      this.awarenessRepo.find({ where: { is_active: true } }),
      this.occCategoryRepo.find({ where: { is_active: true } }),
      this.occupationRepo.find({ where: { is_active: true }, relations: { category: true } }),
      this.workplaceRepo.find({ where: { is_active: true }, relations: { district: true } }),
      this.bankRepo.find(),
      this.providerRepo.find(),
      this.decisionTypeRepo.find({ where: { is_active: true } }),
      this.rejectionReasonRepo.find({ where: { is_active: true } }),
      this.suspectFieldRepo.find({ where: { is_active: true } }),
    ]);

    const districtsByKey = new Map<string, District>();
    const districtsById = new Map<string, District>();
    for (const d of districts) {
      districtsById.set(d.id, d);
      if (d.name) districtsByKey.set(normalizeLookupKey(d.name), d);
    }

    const neighborhoodsByDistrictAndName = new Map<string, Neighborhood>();
    const neighborhoodsByFullLabel = new Map<string, Neighborhood>();
    for (const n of neighborhoods) {
      const nKey = normalizeLookupKey(n.name);
      neighborhoodsByDistrictAndName.set(`${n.district_id}::${nKey}`, n);
      if (n.district?.name) {
        const dKey = normalizeLookupKey(n.district.name);
        neighborhoodsByFullLabel.set(`${dKey} — ${nKey}`, n);
        neighborhoodsByFullLabel.set(`${dKey} - ${nKey}`, n);
      }
    }

    const statusesByKey = new Map<string, ApplicationStatusEntity>();
    for (const s of statuses) {
      statusesByKey.set(normalizeLookupKey(s.name), s);
      if (s.code) statusesByKey.set(normalizeLookupKey(s.code), s);
    }
    const defaultStatus =
      statuses.find((s) => s.is_default) ||
      statuses.find((s) => (s.code || '').toUpperCase() === 'YANGI') ||
      statuses[0] ||
      null;

    const crimesByKey = new Map<string, Crime>();
    for (const c of crimes) {
      const art = (c.article || '').trim();
      const title = (c.title || '').trim();
      if (art) crimesByKey.set(normalizeLookupKey(art), c);
      if (title) crimesByKey.set(normalizeLookupKey(title), c);
      if (art && title) {
        crimesByKey.set(normalizeLookupKey(`${art} — ${title}`), c);
        crimesByKey.set(normalizeLookupKey(`${art} - ${title}`), c);
      }
    }

    const crimeMethodsByKey = new Map<string, CrimeMethod>();
    for (const m of crimeMethods) {
      crimeMethodsByKey.set(normalizeLookupKey(m.name), m);
      if (m.code) crimeMethodsByKey.set(normalizeLookupKey(m.code), m);
    }

    const sourcesByKey = new Map<string, ApplicationSource>();
    for (const s of sources) {
      sourcesByKey.set(normalizeLookupKey(s.name), s);
      if (s.code) sourcesByKey.set(normalizeLookupKey(s.code), s);
    }

    const deptServicesByKey = new Map<string, DepartmentService>();
    for (const ds of deptServices) {
      deptServicesByKey.set(normalizeLookupKey(ds.name), ds);
      if (ds.short_name) deptServicesByKey.set(normalizeLookupKey(ds.short_name), ds);
    }

    const awarenessByKey = new Map<string, AwarenessStatus>();
    for (const a of awarenessList) {
      awarenessByKey.set(normalizeLookupKey(a.name), a);
      if (a.code) awarenessByKey.set(normalizeLookupKey(a.code), a);
    }

    const occCategoriesByKey = new Map<string, OccupationCategory>();
    for (const c of occCategories) {
      occCategoriesByKey.set(normalizeLookupKey(c.name), c);
      if (c.code) occCategoriesByKey.set(normalizeLookupKey(c.code), c);
    }

    const occupationsByCatAndName = new Map<string, Occupation>();
    const occupationsByFullLabel = new Map<string, Occupation>();
    const occupationsByName = new Map<string, Occupation[]>();
    for (const o of occupations) {
      const oKey = normalizeLookupKey(o.name);
      occupationsByCatAndName.set(`${o.category_id}::${oKey}`, o);
      const arr = occupationsByName.get(oKey) || [];
      arr.push(o);
      occupationsByName.set(oKey, arr);
      if (o.category?.name) {
        const cKey = normalizeLookupKey(o.category.name);
        occupationsByFullLabel.set(`${cKey} — ${oKey}`, o);
        occupationsByFullLabel.set(`${cKey} - ${oKey}`, o);
      }
    }

    const workplacesByDistrictAndName = new Map<string, Workplace>();
    const workplacesByFullLabel = new Map<string, Workplace>();
    const workplacesByName = new Map<string, Workplace[]>();
    for (const w of workplaces) {
      const wKey = normalizeLookupKey(w.name);
      if (w.district_id) {
        workplacesByDistrictAndName.set(`${w.district_id}::${wKey}`, w);
      }
      const arr = workplacesByName.get(wKey) || [];
      arr.push(w);
      workplacesByName.set(wKey, arr);
      if (w.district?.name) {
        const dKey = normalizeLookupKey(w.district.name);
        workplacesByFullLabel.set(`${dKey} — ${wKey}`, w);
        workplacesByFullLabel.set(`${dKey} - ${wKey}`, w);
      }
    }

    const banksByKey = new Map<string, Bank>();
    for (const b of banks) {
      if (b.is_active === false) continue;
      if (b.name) banksByKey.set(normalizeLookupKey(b.name), b);
      if (b.code) banksByKey.set(normalizeLookupKey(b.code), b);
      if (b.mfo) banksByKey.set(normalizeLookupKey(b.mfo), b);
    }

    const providersByKey = new Map<string, PaymentProvider>();
    for (const p of providers) {
      if (p.name) providersByKey.set(normalizeLookupKey(p.name), p);
      if (p.code) providersByKey.set(normalizeLookupKey(p.code), p);
    }

    const decisionTypesByKey = new Map<string, DecisionType>();
    for (const dt of decisionTypes) {
      decisionTypesByKey.set(normalizeLookupKey(dt.name), dt);
    }

    const rejectionReasonsByKey = new Map<string, RejectionReason>();
    for (const rr of rejectionReasons) {
      rejectionReasonsByKey.set(normalizeLookupKey(rr.name), rr);
    }

    const suspectFieldsByKey = new Map<string, SuspectFieldConfig>();
    for (const sf of suspectFields) {
      suspectFieldsByKey.set(normalizeLookupKey(sf.label), sf);
      suspectFieldsByKey.set(normalizeLookupKey(sf.key), sf);
    }

    return {
      districtsByKey,
      districtsById,
      neighborhoodsByDistrictAndName,
      neighborhoodsByFullLabel,
      statusesByKey,
      defaultStatus,
      crimesByKey,
      crimeMethodsByKey,
      sourcesByKey,
      deptServicesByKey,
      awarenessByKey,
      occCategoriesByKey,
      occupationsByCatAndName,
      occupationsByFullLabel,
      occupationsByName,
      workplacesByDistrictAndName,
      workplacesByFullLabel,
      workplacesByName,
      banksByKey,
      providersByKey,
      decisionTypesByKey,
      rejectionReasonsByKey,
      suspectFieldsByKey,
    };
  }

  private buildTier2Fingerprint(params: {
    citizenKey: string;
    date: string;
    crimeId: string | null;
    repeatType: ApplicationRepeatType;
    parentRef: string | null;
    amount: number | null;
    description: string | null;
  }): string {
    const payloadPart =
      params.amount && params.amount > 0
        ? `amt:${Math.round(params.amount)}`
        : `desc:${normalizeLookupKey(params.description).slice(0, 120)}`;
    return [
      params.citizenKey,
      `dt:${params.date}`,
      `cr:${params.crimeId || 'none'}`,
      `rp:${params.repeatType}`,
      `pr:${params.parentRef || 'none'}`,
      payloadPart,
    ].join('|');
  }

  private checkTemplateSignature(workbook: ExcelJS.Workbook): boolean {
    const listsSheet = workbook.getWorksheet(SHEET_NAMES.LISTS);
    if (!listsSheet) return false;
    const maxCol = Math.min(listsSheet.columnCount, 100);
    for (let c = 1; c <= maxCol; c++) {
      const label = this.extractText(listsSheet.getCell(1, c).value);
      if (label === 'TEMPLATE_SIGNATURE') {
        const sig = this.extractText(listsSheet.getCell(2, c).value);
        return sig === IMPORT_TEMPLATE_SIGNATURE;
      }
    }
    return false;
  }

  private isSampleRow(firstCellText: string | null): boolean {
    if (!firstCellText) return false;
    return firstCellText.toUpperCase() === IMPORT_SAMPLE_ROW_MARKER;
  }

  private isEmptyRow(row: ExcelJS.Row, colIndexByKey: Map<string, number>): boolean {
    for (const colIdx of colIndexByKey.values()) {
      const val = this.extractText(row.getCell(colIdx).value);
      if (val !== null) return false;
    }
    return true;
  }

  private async analyzeWorkbook(
    fileBuffer: Buffer,
    currentUser?: JwtAccessPayload,
  ): Promise<ParsedWorkbookAnalysis> {
    this.assertCanImport(currentUser);

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException(
        "Excel faylini o'qib bo'lmadi. Faqat haqiqiy .xlsx formatidagi faylni yuklang.",
      );
    }

    const hasSignature = this.checkTemplateSignature(workbook);
    const appSheet = workbook.getWorksheet(SHEET_NAMES.APPLICATIONS) || workbook.worksheets[0];
    if (!appSheet) {
      throw new BadRequestException('Excel faylida ishchi sahifa topilmadi');
    }

    const appHeaders = this.buildHeaderMap(appSheet, APP_IMPORT_COLUMNS);
    if (!hasSignature && appHeaders.matchedCount < 5) {
      throw new BadRequestException(
        "Yuklangan fayl tizimning rasmiy Excel shabloniga mos emas. Iltimos, avval 'Shablonni yuklab olish' tugmasi orqali yangi shablonni oling.",
      );
    }

    const ignoredExtraColumns = [...appHeaders.ignoredHeaders];

    // RBAC va foydalanuvchi ma'lumotlari
    let creatorUserId: string | null = null;
    if (currentUser?.sub) {
      const user = await this.userRepo.findOne({ where: { auth_id: currentUser.sub } });
      creatorUserId = user?.id || null;
    }
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const catalog = await this.loadReferenceCatalog();

    // 1-SAHIFA: Arizalarni o'qish va validatsiya qilish
    const rows: ParsedApplicationRow[] = [];
    const seenLinkCodes = new Map<string, number>();
    const duplicateLinkCodes = new Set<string>();

    for (let r = 2; r <= appSheet.rowCount; r++) {
      const wsRow = appSheet.getRow(r);
      if (this.isEmptyRow(wsRow, appHeaders.colIndexByKey)) continue;

      const getCellVal = (key: string): ExcelJS.CellValue => {
        const idx = appHeaders.colIndexByKey.get(key);
        return idx ? wsRow.getCell(idx).value : null;
      };

      const rawLinkCode = this.extractText(getCellVal('link_code'));
      if (this.isSampleRow(rawLinkCode)) {
        continue;
      }

      if (rows.length >= IMPORT_MAX_ROWS) {
        throw new BadRequestException(
          `Bitta Excel faylida maksimal ${IMPORT_MAX_ROWS} tagacha ariza yuklash mumkin. Iltimos, faylni qismlarga bo'ling.`,
        );
      }

      const rawValues: Record<string, string | number | null> = {};
      for (const col of APP_IMPORT_COLUMNS) {
        rawValues[col.key] = this.extractRawCellValue(getCellVal(col.key));
      }

      const cellErrors = new Map<string, string[]>();
      const errors: string[] = [];
      const warnings: string[] = [];

      // Link code unikalligi
      if (rawLinkCode) {
        const lk = normalizeLookupKey(rawLinkCode);
        const prevRow = seenLinkCodes.get(lk);
        if (prevRow !== undefined) {
          duplicateLinkCodes.add(lk);
          this.addCellError(
            cellErrors,
            errors,
            'link_code',
            `«${rawLinkCode}» bog'lash kodi ${prevRow}-qatorda allaqachon ishlatilgan`,
          );
        } else {
          seenLinkCodes.set(lk, r);
        }
      }

      const appNumber = this.extractText(getCellVal('application_number'));
      if (appNumber && appNumber.length > 50) {
        this.addCellError(
          cellErrors,
          errors,
          'application_number',
          'Ariza raqami 50 belgidan oshmasligi kerak',
        );
      }

      // Ariza sanasi *
      const dateParsed = this.parseDateValue(getCellVal('date'));
      if (dateParsed.error) {
        this.addCellError(cellErrors, errors, 'date', dateParsed.error);
      } else if (!dateParsed.value) {
        this.addCellError(cellErrors, errors, 'date', 'Ariza sanasi kiritilishi shart');
      }

      // Status
      const statusText = this.extractText(getCellVal('status'));
      let statusObj: ApplicationStatusEntity | null = catalog.defaultStatus;
      if (statusText) {
        const foundStatus = catalog.statusesByKey.get(normalizeLookupKey(statusText));
        if (!foundStatus) {
          this.addCellError(
            cellErrors,
            errors,
            'status',
            `«${statusText}» ariza statusi ma'lumotnomada mavjud emas`,
          );
          statusObj = null;
        } else {
          statusObj = foundStatus;
        }
      }

      // Tuman *
      const districtText = this.extractText(getCellVal('district'));
      let districtId: string | null = null;
      let districtName: string | null = null;
      if (!districtText) {
        this.addCellError(cellErrors, errors, 'district', 'Tuman tanlanishi shart');
      } else {
        const foundDistrict = catalog.districtsByKey.get(normalizeLookupKey(districtText));
        if (!foundDistrict) {
          this.addCellError(
            cellErrors,
            errors,
            'district',
            `«${districtText}» tumani bazada topilmadi (ro'yxatdan tanlang)`,
          );
        } else if (allowedDistrictIds !== null && !allowedDistrictIds.includes(foundDistrict.id)) {
          this.addCellError(
            cellErrors,
            errors,
            'district',
            `Sizda «${foundDistrict.name}» tumani uchun ariza yuklash ruxsati yo'q`,
          );
        } else {
          districtId = foundDistrict.id;
          districtName = foundDistrict.name;
        }
      }

      // Murojaat manbasi
      const sourceText = this.extractText(getCellVal('source'));
      let sourceId: string | null = null;
      if (sourceText) {
        const found = catalog.sourcesByKey.get(normalizeLookupKey(sourceText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'source',
            `«${sourceText}» murojaat manbasi bazada topilmadi`,
          );
        } else {
          sourceId = found.id;
        }
      }

      // Sohaviy xizmat
      const deptServiceText = this.extractText(getCellVal('department_service'));
      let departmentServiceId: string | null = null;
      if (deptServiceText) {
        const found = catalog.deptServicesByKey.get(normalizeLookupKey(deptServiceText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'department_service',
            `«${deptServiceText}» sohaviy xizmati bazada topilmadi`,
          );
        } else {
          departmentServiceId = found.id;
        }
      }

      // O'RQ-445 Enumlari
      const appealTypeText = this.extractText(getCellVal('appeal_type'));
      let appealType = AppealType.APPEAL;
      if (appealTypeText) {
        const found = APPEAL_TYPE_LOOKUP.get(normalizeLookupKey(appealTypeText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'appeal_type',
            `«${appealTypeText}» murojaat turi noto'g'ri (Ariza, Shikoyat, Taklif)`,
          );
        } else {
          appealType = found;
        }
      }

      const submissionFormText = this.extractText(getCellVal('submission_form'));
      let submissionForm = SubmissionForm.WRITTEN;
      if (submissionFormText) {
        const found = SUBMISSION_FORM_LOOKUP.get(normalizeLookupKey(submissionFormText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'submission_form',
            `«${submissionFormText}» murojaat shakli noto'g'ri (Yozma, Og'zaki, Elektron)`,
          );
        } else {
          submissionForm = found;
        }
      }

      const applicantTypeText = this.extractText(getCellVal('applicant_type'));
      let applicantType = ApplicantType.INDIVIDUAL;
      if (applicantTypeText) {
        const found = APPLICANT_TYPE_LOOKUP.get(normalizeLookupKey(applicantTypeText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'applicant_type',
            `«${applicantTypeText}» murojaatchi turi noto'g'ri`,
          );
        } else {
          applicantType = found;
        }
      }

      const repeatTypeText = this.extractText(getCellVal('repeat_type'));
      let repeatType = ApplicationRepeatType.PRIMARY;
      if (repeatTypeText) {
        const found = REPEAT_TYPE_LOOKUP.get(normalizeLookupKey(repeatTypeText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'repeat_type',
            `«${repeatTypeText}» takroriylik turi noto'g'ri (Birlamchi, Takroriy, Dublikat, Qo'shimcha)`,
          );
        } else {
          repeatType = found;
        }
      }

      const parentApplicationNumber = this.extractText(getCellVal('parent_application_number'));
      const repeatReason = this.extractText(getCellVal('repeat_reason'));
      if (parentApplicationNumber && repeatType === ApplicationRepeatType.PRIMARY) {
        this.addCellError(
          cellErrors,
          errors,
          'parent_application_number',
          "Avvalgi ariza raqami faqat Takroriy, Dublikat yoki Qo'shimcha murojaatlar uchun kiritiladi",
        );
      }

      // Jinoyat moddasi va Fabula
      const crimeText = this.extractText(getCellVal('crime'));
      let crimeId: string | null = null;
      let crimeLabel: string | null = null;
      if (crimeText) {
        const found = catalog.crimesByKey.get(normalizeLookupKey(crimeText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'crime',
            `«${crimeText}» jinoyat moddasi bazada topilmadi`,
          );
        } else {
          crimeId = found.id;
          crimeLabel = found.article || found.title || crimeText;
        }
      }

      const description = this.extractText(getCellVal('description'));
      if (!crimeId && !crimeText && !description) {
        const msg =
          "Jinoyat moddasi yoki Fabula (Voqea bayoni) dan kamida bittasi to'ldirilishi shart";
        this.addCellError(cellErrors, errors, 'crime', msg);
        this.addCellError(cellErrors, errors, 'description', msg);
      }

      // Jinoyat sodir etish usuli
      const crimeMethodText = this.extractText(getCellVal('crime_method'));
      let crimeMethodId: string | null = null;
      if (crimeMethodText) {
        const found = catalog.crimeMethodsByKey.get(normalizeLookupKey(crimeMethodText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'crime_method',
            `«${crimeMethodText}» jinoyat sodir etish usuli bazada topilmadi`,
          );
        } else {
          crimeMethodId = found.id;
        }
      }

      // Targ'ibot holati
      const awarenessText = this.extractText(getCellVal('awareness_status'));
      let awarenessStatusId: string | null = null;
      if (awarenessText) {
        const found = catalog.awarenessByKey.get(normalizeLookupKey(awarenessText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'awareness_status',
            `«${awarenessText}» targ'ibot holati bazada topilmadi`,
          );
        } else {
          awarenessStatusId = found.id;
        }
      }
      const awarenessNote = this.extractText(getCellVal('awareness_note'));
      if (awarenessNote && awarenessNote.length > 300) {
        this.addCellError(
          cellErrors,
          errors,
          'awareness_note',
          "Targ'ibot izohi 300 belgidan oshmasligi kerak",
        );
      }

      // Fuqaro maydonlari
      const rawLastName = this.extractText(getCellVal('citizen_last_name'));
      const rawFirstName = this.extractText(getCellVal('citizen_first_name'));
      const rawMiddleName = this.extractText(getCellVal('citizen_middle_name'));
      if (!rawLastName) {
        this.addCellError(
          cellErrors,
          errors,
          'citizen_last_name',
          'Arizachi familiyasi kiritilishi shart',
        );
      }
      if (!rawFirstName) {
        this.addCellError(
          cellErrors,
          errors,
          'citizen_first_name',
          'Arizachi ismi kiritilishi shart',
        );
      }

      const genderText = this.extractText(getCellVal('citizen_gender'));
      let citizenGender: 'male' | 'female' | null = null;
      if (genderText) {
        const found = GENDER_LOOKUP.get(normalizeLookupKey(genderText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'citizen_gender',
            `«${genderText}» jinsi noto'g'ri (Erkak yoki Ayol tanlang)`,
          );
        } else {
          citizenGender = found;
        }
      }

      const birthDateParsed = this.parseDateValue(getCellVal('citizen_birth_date'));
      if (birthDateParsed.error) {
        this.addCellError(cellErrors, errors, 'citizen_birth_date', birthDateParsed.error);
      }

      // Identifikatorlar: Telefon, Pasport, JSHSHIR (kamida 1 tasi majburiy)
      const rawPhone = this.extractText(getCellVal('citizen_phone'));
      let citizenPhone: string | null = null;
      if (rawPhone) {
        const norm = normalizeUzPhone(rawPhone);
        if (!norm || norm.length < 9 || norm.length > 15) {
          this.addCellError(
            cellErrors,
            errors,
            'citizen_phone',
            `«${rawPhone}» telefon raqami noto'g'ri (masalan: +998901234567)`,
          );
        } else {
          citizenPhone = norm;
        }
      }

      const rawPassport = this.extractText(getCellVal('citizen_passport'));
      let citizenPassport: string | null = null;
      if (rawPassport) {
        const norm = normalizePassport(rawPassport);
        if (!norm || norm.length < 6 || norm.length > 20) {
          this.addCellError(
            cellErrors,
            errors,
            'citizen_passport',
            `«${rawPassport}» pasport seriya/raqami noto'g'ri (masalan: AB1234567)`,
          );
        } else {
          citizenPassport = norm;
        }
      }

      const rawPinfl = this.extractText(getCellVal('citizen_pinfl'));
      let citizenPinfl: string | null = null;
      if (rawPinfl) {
        if (/e\+/i.test(rawPinfl)) {
          this.addCellError(
            cellErrors,
            errors,
            'citizen_pinfl',
            'JSHSHIR ilmiy formatda buzilgan. Matn sifatida 14 ta raqam kiriting',
          );
        } else {
          const norm = normalizePinfl(rawPinfl);
          if (!norm || norm.length !== 14) {
            this.addCellError(
              cellErrors,
              errors,
              'citizen_pinfl',
              `JSHSHIR (PINFL) aniq 14 ta raqamdan iborat bo'lishi kerak (kiritilgan: «${rawPinfl}»)`,
            );
          } else {
            citizenPinfl = norm;
          }
        }
      }

      if (!rawPhone && !rawPassport && !rawPinfl) {
        const msg =
          'Fuqaro uchun kamida bitta identifikator (Telefon, Pasport yoki JSHSHIR) kiritilishi shart';
        this.addCellError(cellErrors, errors, 'citizen_phone', msg);
        this.addCellError(cellErrors, errors, 'citizen_passport', msg);
        this.addCellError(cellErrors, errors, 'citizen_pinfl', msg);
      }

      // Yashash tumani va Mahallasi
      const citizenDistrictText = this.extractText(getCellVal('citizen_district'));
      let citizenDistrictId: string | null = districtId;
      if (citizenDistrictText) {
        const found = catalog.districtsByKey.get(normalizeLookupKey(citizenDistrictText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'citizen_district',
            `«${citizenDistrictText}» yashash tumani bazada topilmadi`,
          );
        } else {
          citizenDistrictId = found.id;
        }
      }

      const neighborhoodText = this.extractText(getCellVal('citizen_neighborhood'));
      let citizenNeighborhoodId: string | null = null;
      if (neighborhoodText) {
        const normFull = normalizeLookupKey(neighborhoodText);
        let matchedN = catalog.neighborhoodsByFullLabel.get(normFull) || null;
        if (!matchedN && citizenDistrictId) {
          matchedN =
            catalog.neighborhoodsByDistrictAndName.get(`${citizenDistrictId}::${normFull}`) || null;
        }
        if (!matchedN) {
          this.addCellError(
            cellErrors,
            errors,
            'citizen_neighborhood',
            `«${neighborhoodText}» mahallasi tanlangan tuman ma'lumotnomasida topilmadi`,
          );
        } else {
          if (citizenDistrictId && matchedN.district_id !== citizenDistrictId) {
            // Agar foydalanuvchi yashash tumanini alohida ko'rsatmagan bo'lsa, mahalla tumanini qabul qilamiz
            if (!citizenDistrictText) {
              citizenDistrictId = matchedN.district_id;
            } else {
              this.addCellError(
                cellErrors,
                errors,
                'citizen_neighborhood',
                `«${neighborhoodText}» mahallasi ko'rsatilgan yashash tumaniga tegishli emas`,
              );
            }
          }
          if (!cellErrors.has('citizen_neighborhood')) {
            citizenNeighborhoodId = matchedN.id;
          }
        }
      }

      const citizenAddress = this.extractText(getCellVal('citizen_address'));

      // Kasb toifasi va Kasb turi
      const occCatText = this.extractText(getCellVal('occupation_category'));
      let occupationCategoryId: string | null = null;
      if (occCatText) {
        const found = catalog.occCategoriesByKey.get(normalizeLookupKey(occCatText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'occupation_category',
            `«${occCatText}» kasb toifasi bazada topilmadi`,
          );
        } else {
          occupationCategoryId = found.id;
        }
      }

      const occText = this.extractText(getCellVal('occupation'));
      let occupationId: string | null = null;
      if (occText) {
        const normOcc = normalizeLookupKey(occText);
        let foundOcc = catalog.occupationsByFullLabel.get(normOcc) || null;
        if (!foundOcc && occupationCategoryId) {
          foundOcc =
            catalog.occupationsByCatAndName.get(`${occupationCategoryId}::${normOcc}`) || null;
        }
        if (!foundOcc) {
          const candidates = catalog.occupationsByName.get(normOcc) || [];
          if (candidates.length === 1) {
            foundOcc = candidates[0];
          } else if (candidates.length > 1) {
            this.addCellError(
              cellErrors,
              errors,
              'occupation',
              `«${occText}» kasbi bir nechta toifada mavjud — 'Kasb toifasi' ustunini ham tanlang`,
            );
          }
        }
        if (!foundOcc && !cellErrors.has('occupation')) {
          this.addCellError(
            cellErrors,
            errors,
            'occupation',
            `«${occText}» kasb turi bazada topilmadi`,
          );
        } else if (foundOcc) {
          if (occupationCategoryId && foundOcc.category_id !== occupationCategoryId) {
            this.addCellError(
              cellErrors,
              errors,
              'occupation',
              `«${occText}» kasb turi tanlangan kasb toifasiga tegishli emas`,
            );
          } else {
            occupationId = foundOcc.id;
            if (!occupationCategoryId) {
              occupationCategoryId = foundOcc.category_id;
            }
          }
        }
      }

      // Ish joyi / Tashkilot
      const workplaceText = this.extractText(getCellVal('workplace'));
      let workplaceId: string | null = null;
      if (workplaceText) {
        const normWp = normalizeLookupKey(workplaceText);
        let foundWp = catalog.workplacesByFullLabel.get(normWp) || null;
        if (!foundWp && citizenDistrictId) {
          foundWp =
            catalog.workplacesByDistrictAndName.get(`${citizenDistrictId}::${normWp}`) || null;
        }
        if (!foundWp && districtId && districtId !== citizenDistrictId) {
          foundWp = catalog.workplacesByDistrictAndName.get(`${districtId}::${normWp}`) || null;
        }
        if (!foundWp) {
          const candidates = catalog.workplacesByName.get(normWp) || [];
          if (candidates.length === 1) {
            foundWp = candidates[0];
          } else if (candidates.length > 1) {
            this.addCellError(
              cellErrors,
              errors,
              'workplace',
              `«${workplaceText}» tashkiloti bir nechta tumanda mavjud — dropdown orqali 'Tuman — Tashkilot' shaklida tanlang`,
            );
          }
        }
        if (!foundWp && !cellErrors.has('workplace')) {
          this.addCellError(
            cellErrors,
            errors,
            'workplace',
            `«${workplaceText}» ish joyi / tashkiloti bazada topilmadi`,
          );
        } else if (foundWp) {
          workplaceId = foundWp.id;
        }
      }
      const workPosition = this.extractText(getCellVal('work_position'));

      // Asosiy moliyaviy o'tkazma va kartalar
      const victimCardParsed = this.parseCardNumber(getCellVal('victim_card_number'));
      if (victimCardParsed.error) {
        this.addCellError(cellErrors, errors, 'victim_card_number', victimCardParsed.error);
      }

      const victimBankText = this.extractText(getCellVal('victim_card_bank'));
      let victimBankId: string | null = null;
      if (victimBankText) {
        const found = catalog.banksByKey.get(normalizeLookupKey(victimBankText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'victim_card_bank',
            `«${victimBankText}» banki bazada topilmadi`,
          );
        } else {
          victimBankId = found.id;
        }
      }
      const victimCardFullName = this.extractText(getCellVal('victim_card_full_name'));
      if (
        (victimBankText || victimCardFullName) &&
        !victimCardParsed.value &&
        !victimCardParsed.error
      ) {
        this.addCellError(
          cellErrors,
          errors,
          'victim_card_number',
          'Jabrlanuvchi karta banki/egasi kiritilgan, lekin 16 raqamli karta raqami bo‘sh',
        );
      }

      const amountParsed = this.parsePositiveNumber(getCellVal('transfer_amount'), 'Zarar summasi');
      if (amountParsed.error) {
        this.addCellError(cellErrors, errors, 'transfer_amount', amountParsed.error);
      }

      const currencyText = this.extractText(getCellVal('transfer_currency'));
      let transferCurrency = 'UZS';
      if (currencyText) {
        const upper = currencyText.toUpperCase();
        if (!CURRENCY_SET.has(upper)) {
          this.addCellError(
            cellErrors,
            errors,
            'transfer_currency',
            `«${currencyText}» valyutasi noto'g'ri (UZS, USD, EUR, RUB)`,
          );
        } else {
          transferCurrency = upper;
        }
      }

      const providerText = this.extractText(getCellVal('payment_provider'));
      let paymentProviderId: string | null = null;
      if (providerText) {
        const found = catalog.providersByKey.get(normalizeLookupKey(providerText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'payment_provider',
            `«${providerText}» to'lov provayderi bazada topilmadi`,
          );
        } else {
          paymentProviderId = found.id;
        }
      }

      const destTypeText = this.extractText(getCellVal('destination_type'));
      let destinationType = TransferDestinationType.CARD;
      if (destTypeText) {
        const found = DESTINATION_TYPE_LOOKUP.get(normalizeLookupKey(destTypeText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'destination_type',
            `«${destTypeText}» chiqish kanali turi noto'g'ri`,
          );
        } else {
          destinationType = found;
        }
      }

      const receiverCardParsed = this.parseCardNumber(getCellVal('receiver_card_number'));
      if (receiverCardParsed.error) {
        this.addCellError(cellErrors, errors, 'receiver_card_number', receiverCardParsed.error);
      }

      const receiverBankText = this.extractText(getCellVal('receiver_card_bank'));
      let receiverBankId: string | null = null;
      if (receiverBankText) {
        const found = catalog.banksByKey.get(normalizeLookupKey(receiverBankText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'receiver_card_bank',
            `«${receiverBankText}» banki bazada topilmadi`,
          );
        } else {
          receiverBankId = found.id;
        }
      }
      const receiverCardFullName = this.extractText(getCellVal('receiver_card_full_name'));
      if (
        (receiverBankText || receiverCardFullName) &&
        !receiverCardParsed.value &&
        !receiverCardParsed.error
      ) {
        this.addCellError(
          cellErrors,
          errors,
          'receiver_card_number',
          'Firibgar karta banki/egasi kiritilgan, lekin 16 raqamli karta raqami bo‘sh',
        );
      }

      const destinationLabel = this.extractText(getCellVal('destination_label'));

      const transferDateParsed = this.parseDateValue(getCellVal('transfer_date'));
      if (transferDateParsed.error) {
        this.addCellError(cellErrors, errors, 'transfer_date', transferDateParsed.error);
      }

      const transferTimeParsed = this.parseTimeValue(getCellVal('transfer_time'));
      if (transferTimeParsed.error) {
        this.addCellError(cellErrors, errors, 'transfer_time', transferTimeParsed.error);
      }

      const transactionId = this.extractText(getCellVal('transaction_id'));

      // SLA va Qaror
      const slaParsed = this.parsePositiveNumber(getCellVal('sla_days'), 'SLA kun');
      let slaDays: number | null = null;
      if (slaParsed.error) {
        this.addCellError(cellErrors, errors, 'sla_days', slaParsed.error);
      } else if (slaParsed.value !== null) {
        if (!Number.isInteger(slaParsed.value) || slaParsed.value > 365) {
          this.addCellError(
            cellErrors,
            errors,
            'sla_days',
            'SLA kunlari 1 dan 365 gacha butun son bo‘lishi kerak',
          );
        } else {
          slaDays = slaParsed.value;
        }
      }

      const decisionTypeText = this.extractText(getCellVal('decision_type'));
      let decisionTypeId: string | null = null;
      if (decisionTypeText) {
        const found = catalog.decisionTypesByKey.get(normalizeLookupKey(decisionTypeText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'decision_type',
            `«${decisionTypeText}» yakuniy qaror turi bazada topilmadi`,
          );
        } else {
          decisionTypeId = found.id;
        }
      }

      const decisionNumber = this.extractText(getCellVal('decision_number'));
      const decisionDateParsed = this.parseDateValue(getCellVal('decision_date'));
      if (decisionDateParsed.error) {
        this.addCellError(cellErrors, errors, 'decision_date', decisionDateParsed.error);
      }

      const rejectionReasonText = this.extractText(getCellVal('rejection_reason'));
      let rejectionReasonId: string | null = null;
      if (rejectionReasonText) {
        const found = catalog.rejectionReasonsByKey.get(normalizeLookupKey(rejectionReasonText));
        if (!found) {
          this.addCellError(
            cellErrors,
            errors,
            'rejection_reason',
            `«${rejectionReasonText}» rad etish sababi bazada topilmadi`,
          );
        } else {
          rejectionReasonId = found.id;
        }
      }

      const officerNotes = this.extractText(getCellVal('officer_notes'));

      rows.push({
        rowNumber: r,
        linkCode: rawLinkCode,
        rawValues,
        applicationNumber: appNumber,
        date: dateParsed.value,
        statusId: statusObj?.id || null,
        statusCode: statusObj?.code || statusObj?.name || null,
        statusObj,
        districtId,
        districtName,
        sourceId,
        departmentServiceId,
        appealType,
        submissionForm,
        applicantType,
        repeatType,
        parentApplicationNumber,
        parentApplicationId: null,
        repeatReason,
        crimeId,
        crimeLabel,
        crimeMethodId,
        awarenessStatusId,
        awarenessNote,
        citizenLastName: rawLastName ? formatUzbekName(rawLastName) : null,
        citizenFirstName: rawFirstName ? formatUzbekName(rawFirstName) : null,
        citizenMiddleName: rawMiddleName ? formatUzbekName(rawMiddleName) : null,
        citizenGender,
        citizenBirthDate: birthDateParsed.value,
        citizenPhone,
        citizenPassport,
        citizenPinfl,
        citizenDistrictId,
        citizenNeighborhoodId,
        citizenAddress,
        occupationCategoryId,
        occupationId,
        workplaceId,
        workPosition,
        victimCardNumber: victimCardParsed.value,
        victimBankId,
        victimCardFullName: victimCardFullName ? formatUzbekName(victimCardFullName) : null,
        transferAmount: amountParsed.value,
        transferCurrency,
        paymentProviderId,
        destinationType,
        receiverCardNumber: receiverCardParsed.value,
        receiverBankId,
        receiverCardFullName: receiverCardFullName ? formatUzbekName(receiverCardFullName) : null,
        destinationLabel,
        transferDate: transferDateParsed.value,
        transferTime: transferTimeParsed.value,
        transactionId,
        slaDays,
        decisionTypeId,
        decisionNumber,
        decisionDate: decisionDateParsed.value,
        rejectionReasonId,
        description,
        officerNotes,
        extraTransfers: [],
        suspectClues: [],
        matchedCitizenId: null,
        matchedCards: [],
        status: errors.length > 0 ? 'ERROR' : 'READY',
        duplicateReason: null,
        cellErrors,
        errors,
        warnings,
      });
    }

    // 1-sahifa qatorlarini link_code va application_number bo'yicha indekslash
    const appRowByRef = new Map<string, ParsedApplicationRow>();
    for (const row of rows) {
      if (row.linkCode) {
        const lk = normalizeLookupKey(row.linkCode);
        if (!appRowByRef.has(lk)) {
          appRowByRef.set(lk, row);
        }
      }
      if (row.applicationNumber) {
        const ak = normalizeLookupKey(row.applicationNumber);
        if (!appRowByRef.has(ak)) {
          appRowByRef.set(ak, row);
        }
      }
    }

    // 2-SAHIFA: Qo'shimcha o'tkazmalarni o'qish
    const orphanTransfers: ParsedExtraTransferRow[] = [];
    const transfersSheet = workbook.getWorksheet(SHEET_NAMES.EXTRA_TRANSFERS);
    if (transfersSheet) {
      const trHeaders = this.buildHeaderMap(transfersSheet, EXTRA_TRANSFER_IMPORT_COLUMNS);
      ignoredExtraColumns.push(
        ...trHeaders.ignoredHeaders.map((h) => `${SHEET_NAMES.EXTRA_TRANSFERS}: ${h}`),
      );

      for (let r = 2; r <= transfersSheet.rowCount; r++) {
        const wsRow = transfersSheet.getRow(r);
        if (this.isEmptyRow(wsRow, trHeaders.colIndexByKey)) continue;

        const getVal = (key: string): ExcelJS.CellValue => {
          const idx = trHeaders.colIndexByKey.get(key);
          return idx ? wsRow.getCell(idx).value : null;
        };

        const rawRef = this.extractText(getVal('app_ref'));
        if (this.isSampleRow(rawRef)) continue;

        const rawValues: Record<string, string | number | null> = {};
        for (const col of EXTRA_TRANSFER_IMPORT_COLUMNS) {
          rawValues[col.key] = this.extractRawCellValue(getVal(col.key));
        }

        const cellErrors = new Map<string, string[]>();
        const errors: string[] = [];

        if (!rawRef) {
          this.addCellError(
            cellErrors,
            errors,
            'app_ref',
            "Ariza bog'lash kodi / Ariza № kiritilishi shart",
          );
        }

        const victimCard = this.parseCardNumber(getVal('victim_card_number'));
        if (victimCard.error) {
          this.addCellError(cellErrors, errors, 'victim_card_number', victimCard.error);
        }

        const victimBankText = this.extractText(getVal('victim_card_bank'));
        let victimBankId: string | null = null;
        if (victimBankText) {
          const found = catalog.banksByKey.get(normalizeLookupKey(victimBankText));
          if (!found) {
            this.addCellError(
              cellErrors,
              errors,
              'victim_card_bank',
              `«${victimBankText}» banki bazada topilmadi`,
            );
          } else {
            victimBankId = found.id;
          }
        }

        const amt = this.parsePositiveNumber(getVal('amount'), "O'tkazma summasi");
        if (amt.error) {
          this.addCellError(cellErrors, errors, 'amount', amt.error);
        } else if (amt.value === null) {
          this.addCellError(cellErrors, errors, 'amount', "O'tkazma summasi kiritilishi shart");
        }

        const curText = this.extractText(getVal('currency'));
        let currency = 'UZS';
        if (curText) {
          const u = curText.toUpperCase();
          if (!CURRENCY_SET.has(u)) {
            this.addCellError(
              cellErrors,
              errors,
              'currency',
              `«${curText}» valyutasi noto'g'ri (UZS, USD, EUR, RUB)`,
            );
          } else {
            currency = u;
          }
        }

        const provText = this.extractText(getVal('payment_provider'));
        let paymentProviderId: string | null = null;
        if (provText) {
          const found = catalog.providersByKey.get(normalizeLookupKey(provText));
          if (!found) {
            this.addCellError(
              cellErrors,
              errors,
              'payment_provider',
              `«${provText}» to'lov provayderi bazada topilmadi`,
            );
          } else {
            paymentProviderId = found.id;
          }
        }

        const destText = this.extractText(getVal('destination_type'));
        let destinationType = TransferDestinationType.CARD;
        if (destText) {
          const found = DESTINATION_TYPE_LOOKUP.get(normalizeLookupKey(destText));
          if (!found) {
            this.addCellError(
              cellErrors,
              errors,
              'destination_type',
              `«${destText}» chiqish kanali turi noto'g'ri`,
            );
          } else {
            destinationType = found;
          }
        }

        const recCard = this.parseCardNumber(getVal('receiver_card_number'));
        if (recCard.error) {
          this.addCellError(cellErrors, errors, 'receiver_card_number', recCard.error);
        }

        const recBankText = this.extractText(getVal('receiver_card_bank'));
        let receiverBankId: string | null = null;
        if (recBankText) {
          const found = catalog.banksByKey.get(normalizeLookupKey(recBankText));
          if (!found) {
            this.addCellError(
              cellErrors,
              errors,
              'receiver_card_bank',
              `«${recBankText}» banki bazada topilmadi`,
            );
          } else {
            receiverBankId = found.id;
          }
        }

        const recFullName = this.extractText(getVal('receiver_card_full_name'));
        const destinationLabel = this.extractText(getVal('destination_label'));
        const tDate = this.parseDateValue(getVal('transfer_date'));
        if (tDate.error) this.addCellError(cellErrors, errors, 'transfer_date', tDate.error);
        const tTime = this.parseTimeValue(getVal('transfer_time'));
        if (tTime.error) this.addCellError(cellErrors, errors, 'transfer_time', tTime.error);
        const transactionId = this.extractText(getVal('transaction_id'));

        const parsedTr: ParsedExtraTransferRow = {
          rowNumber: r,
          appRef: rawRef || '',
          rawValues,
          victimCardNumber: victimCard.value,
          victimBankId,
          amount: amt.value,
          currency,
          paymentProviderId,
          destinationType,
          receiverCardNumber: recCard.value,
          receiverBankId,
          receiverCardFullName: recFullName ? formatUzbekName(recFullName) : null,
          destinationLabel,
          transferDate: tDate.value,
          transferTime: tTime.value,
          transactionId,
          cellErrors,
          errors,
        };

        const normRef = rawRef ? normalizeLookupKey(rawRef) : '';
        const parentApp = normRef ? appRowByRef.get(normRef) : undefined;
        if (normRef && duplicateLinkCodes.has(normRef)) {
          const msg = `«${rawRef}» bog'lash kodi 1-sahifada bir nechta qatorda takrorlangan — qaysi arizaga tegishliligi noaniq`;
          this.addCellError(cellErrors, errors, 'app_ref', msg);
          orphanTransfers.push(parsedTr);
          if (parentApp) {
            this.addCellError(parentApp.cellErrors, parentApp.errors, 'link_code', msg);
            parentApp.status = 'ERROR';
          }
        } else if (!parentApp) {
          this.addCellError(
            cellErrors,
            errors,
            'app_ref',
            `«${rawRef || "bo'sh"}» kodiga mos ariza 1-sahifada topilmadi`,
          );
          orphanTransfers.push(parsedTr);
        } else {
          parentApp.extraTransfers.push(parsedTr);
          if (errors.length > 0) {
            this.addCellError(
              parentApp.cellErrors,
              parentApp.errors,
              'link_code',
              `2-sahifa (${r}-qator, qo'shimcha o'tkazma): ${errors.join('; ')}`,
            );
            parentApp.status = 'ERROR';
          }
        }
      }
    }

    // 3-SAHIFA: Gumonlanuvchi izlarini o'qish
    const orphanSuspects: ParsedSuspectClueRow[] = [];
    const suspectsSheet = workbook.getWorksheet(SHEET_NAMES.SUSPECT_CLUES);
    if (suspectsSheet) {
      const sHeaders = this.buildHeaderMap(suspectsSheet, SUSPECT_CLUE_IMPORT_COLUMNS);
      ignoredExtraColumns.push(
        ...sHeaders.ignoredHeaders.map((h) => `${SHEET_NAMES.SUSPECT_CLUES}: ${h}`),
      );

      for (let r = 2; r <= suspectsSheet.rowCount; r++) {
        const wsRow = suspectsSheet.getRow(r);
        if (this.isEmptyRow(wsRow, sHeaders.colIndexByKey)) continue;

        const getVal = (key: string): ExcelJS.CellValue => {
          const idx = sHeaders.colIndexByKey.get(key);
          return idx ? wsRow.getCell(idx).value : null;
        };

        const rawRef = this.extractText(getVal('app_ref'));
        if (this.isSampleRow(rawRef)) continue;

        const rawValues: Record<string, string | number | null> = {};
        for (const col of SUSPECT_CLUE_IMPORT_COLUMNS) {
          rawValues[col.key] = this.extractRawCellValue(getVal(col.key));
        }

        const cellErrors = new Map<string, string[]>();
        const errors: string[] = [];

        if (!rawRef) {
          this.addCellError(
            cellErrors,
            errors,
            'app_ref',
            "Ariza bog'lash kodi / Ariza № kiritilishi shart",
          );
        }

        const typeText = this.extractText(getVal('field_type'));
        let fieldKey: string | null = null;
        let fieldLabel: string | null = null;
        if (!typeText) {
          this.addCellError(cellErrors, errors, 'field_type', 'Iz turi tanlanishi shart');
        } else {
          const found = catalog.suspectFieldsByKey.get(normalizeLookupKey(typeText));
          if (!found) {
            this.addCellError(
              cellErrors,
              errors,
              'field_type',
              `«${typeText}» gumonlanuvchi iz turi katalogda topilmadi`,
            );
          } else {
            fieldKey = found.key;
            fieldLabel = found.label;
          }
        }

        const clueVal = this.extractText(getVal('value'));
        if (!clueVal) {
          this.addCellError(cellErrors, errors, 'value', 'Iz qiymati kiritilishi shart');
        }
        const clueNote = this.extractText(getVal('note'));

        const parsedClue: ParsedSuspectClueRow = {
          rowNumber: r,
          appRef: rawRef || '',
          rawValues,
          fieldKey,
          fieldLabel,
          value: clueVal,
          note: clueNote,
          cellErrors,
          errors,
        };

        const normRef = rawRef ? normalizeLookupKey(rawRef) : '';
        const parentApp = normRef ? appRowByRef.get(normRef) : undefined;
        if (normRef && duplicateLinkCodes.has(normRef)) {
          const msg = `«${rawRef}» bog'lash kodi 1-sahifada bir nechta qatorda takrorlangan — qaysi arizaga tegishliligi noaniq`;
          this.addCellError(cellErrors, errors, 'app_ref', msg);
          orphanSuspects.push(parsedClue);
          if (parentApp) {
            this.addCellError(parentApp.cellErrors, parentApp.errors, 'link_code', msg);
            parentApp.status = 'ERROR';
          }
        } else if (!parentApp) {
          this.addCellError(
            cellErrors,
            errors,
            'app_ref',
            `«${rawRef || "bo'sh"}» kodiga mos ariza 1-sahifada topilmadi`,
          );
          orphanSuspects.push(parsedClue);
        } else {
          parentApp.suspectClues.push(parsedClue);
          if (errors.length > 0) {
            this.addCellError(
              parentApp.cellErrors,
              parentApp.errors,
              'link_code',
              `3-sahifa (${r}-qator, gumonlanuvchi izi): ${errors.join('; ')}`,
            );
            parentApp.status = 'ERROR';
          }
        }
      }
    }

    // BATCH DB TEKSHIRUVLARI (N+1 so'rovlarsiz: mavjud arizalar, ota arizalar, fuqarolar, kartalar, transaction_id)
    await this.runBatchDatabaseChecks(rows);

    return {
      templateValid: hasSignature || appHeaders.matchedCount >= 5,
      creatorUserId,
      allowedDistrictIds,
      ignoredExtraColumns,
      rows,
      orphanTransfers,
      orphanSuspects,
    };
  }

  private async runBatchDatabaseChecks(rows: ParsedApplicationRow[]): Promise<void> {
    if (rows.length === 0) return;

    const appNumbers = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.applicationNumber, r.parentApplicationNumber])
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const passports = Array.from(
      new Set(rows.map((r) => r.citizenPassport).filter((v): v is string => Boolean(v))),
    );
    const pinfls = Array.from(
      new Set(rows.map((r) => r.citizenPinfl).filter((v): v is string => Boolean(v))),
    );
    const phones = Array.from(
      new Set(rows.map((r) => r.citizenPhone).filter((v): v is string => Boolean(v))),
    );
    const cardNumbers = Array.from(
      new Set(
        rows
          .flatMap((r) => [
            r.victimCardNumber,
            r.receiverCardNumber,
            ...r.extraTransfers.flatMap((t) => [t.victimCardNumber, t.receiverCardNumber]),
          ])
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const txIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.transactionId, ...r.extraTransfers.map((t) => t.transactionId)])
          .filter((v): v is string => Boolean(v)),
      ),
    );

    const [
      existingAppsByNum,
      citizensByPassport,
      citizensByPinfl,
      citizensByPhone,
      existingCards,
      existingTransfersByTxId,
    ] = await Promise.all([
      appNumbers.length > 0
        ? this.applicationRepo
            .createQueryBuilder('a')
            .select(['a.id', 'a.application_number'])
            .where('a.is_deleted = false')
            .andWhere('LOWER(a.application_number) IN (:...nums)', {
              nums: appNumbers.map((n) => n.toLowerCase()),
            })
            .getMany()
        : Promise.resolve([]),
      passports.length > 0
        ? this.citizenRepo.find({
            where: { passport: In(passports) },
            select: { id: true, passport: true, pinfl: true, phone_number: true },
          })
        : Promise.resolve([]),
      pinfls.length > 0
        ? this.citizenRepo.find({
            where: { pinfl: In(pinfls) },
            select: { id: true, passport: true, pinfl: true, phone_number: true },
          })
        : Promise.resolve([]),
      phones.length > 0
        ? this.citizenRepo.find({
            where: { phone_number: In(phones) },
            select: { id: true, passport: true, pinfl: true, phone_number: true },
          })
        : Promise.resolve([]),
      cardNumbers.length > 0
        ? this.cardRepo.find({
            where: { card_number: In(cardNumbers) },
            select: { id: true, card_number: true },
          })
        : Promise.resolve([]),
      txIds.length > 0
        ? this.transferRepo.find({
            where: { transaction_id: In(txIds) },
            select: { id: true, transaction_id: true },
          })
        : Promise.resolve([]),
    ]);

    const dbAppIdByNumLower = new Map<string, string>();
    for (const a of existingAppsByNum) {
      if (a.application_number) {
        dbAppIdByNumLower.set(a.application_number.trim().toLowerCase(), a.id);
      }
    }

    const citizenByPassportMap = new Map<string, Citizen>();
    for (const c of citizensByPassport) {
      if (c.passport) citizenByPassportMap.set(c.passport, c);
    }
    const citizenByPinflMap = new Map<string, Citizen>();
    for (const c of citizensByPinfl) {
      if (c.pinfl) citizenByPinflMap.set(c.pinfl, c);
    }
    const citizenByPhoneMap = new Map<string, Citizen>();
    for (const c of citizensByPhone) {
      if (c.phone_number) citizenByPhoneMap.set(c.phone_number, c);
    }

    const existingCardSet = new Set<string>(
      existingCards.map((c) => c.card_number).filter((v): v is string => Boolean(v)),
    );
    const existingTxIdSet = new Set<string>(
      existingTransfersByTxId.map((t) => t.transaction_id).filter((v): v is string => Boolean(v)),
    );

    // Har bir qator uchun mavjud fuqaro va kartalarni aniqlash
    const matchedCitizenIds = new Set<string>();
    for (const row of rows) {
      const matchedCitizen =
        (row.citizenPassport ? citizenByPassportMap.get(row.citizenPassport) : undefined) ||
        (row.citizenPinfl ? citizenByPinflMap.get(row.citizenPinfl) : undefined) ||
        (row.citizenPhone ? citizenByPhoneMap.get(row.citizenPhone) : undefined) ||
        null;

      if (matchedCitizen) {
        row.matchedCitizenId = matchedCitizen.id;
        matchedCitizenIds.add(matchedCitizen.id);
      }

      const rowCards = [
        row.victimCardNumber,
        row.receiverCardNumber,
        ...row.extraTransfers.flatMap((t) => [t.victimCardNumber, t.receiverCardNumber]),
      ].filter((v): v is string => Boolean(v));
      row.matchedCards = Array.from(new Set(rowCards.filter((c) => existingCardSet.has(c))));
    }

    // 2-darajali dublikat tekshiruvi uchun mos fuqarolarning bazadagi mavjud arizalarini 1 so'rovda yuklash
    const dbFingerprints = new Map<string, string>();
    if (matchedCitizenIds.size > 0) {
      const citizenApps = await this.applicationRepo
        .createQueryBuilder('a')
        .leftJoinAndSelect('a.transfer', 'tr')
        .select([
          'a.id',
          'a.application_number',
          'a.citizen_id',
          'a.date',
          'a.crime_id',
          'a.repeat_type',
          'a.parent_application_id',
          'a.description',
          'tr.id',
          'tr.amount',
        ])
        .where('a.is_deleted = false')
        .andWhere('a.citizen_id IN (:...cids)', { cids: Array.from(matchedCitizenIds) })
        .getMany();

      for (const a of citizenApps) {
        if (!a.citizen_id || !a.date) continue;
        const dateStr = this.formatDateUTC(new Date(a.date));
        const fp = this.buildTier2Fingerprint({
          citizenKey: `cid:${a.citizen_id}`,
          date: dateStr,
          crimeId: a.crime_id,
          repeatType: a.repeat_type || ApplicationRepeatType.PRIMARY,
          parentRef: a.parent_application_id,
          amount: a.transfer?.amount ? Number(a.transfer.amount) : null,
          description: a.description,
        });
        dbFingerprints.set(fp, a.application_number || a.id.slice(0, 8));
      }
    }

    // Qatorlar bo'yicha dublikat, parent_application_number va transaction_id unikalligi tekshiruvi
    const seenFileAppNumbers = new Map<string, number>();
    const seenFileFingerprints = new Map<string, number>();
    const seenFileTxIds = new Map<string, string>();

    for (const row of rows) {
      // Tranzaksiya ID unikalligi (asosiy)
      if (row.transactionId) {
        if (existingTxIdSet.has(row.transactionId)) {
          this.addCellError(
            row.cellErrors,
            row.errors,
            'transaction_id',
            `«${row.transactionId}» tranzaksiya ID bazada allaqachon mavjud`,
          );
          row.status = 'ERROR';
        } else {
          const prevOwner = seenFileTxIds.get(row.transactionId);
          if (prevOwner) {
            this.addCellError(
              row.cellErrors,
              row.errors,
              'transaction_id',
              `«${row.transactionId}» tranzaksiya ID ushbu faylda (${prevOwner}) takrorlangan`,
            );
            row.status = 'ERROR';
          } else {
            seenFileTxIds.set(row.transactionId, `1-sahifa ${row.rowNumber}-qator`);
          }
        }
      }

      // Tranzaksiya ID unikalligi (qo'shimcha o'tkazmalar)
      for (const tr of row.extraTransfers) {
        if (!tr.transactionId) continue;
        if (existingTxIdSet.has(tr.transactionId)) {
          const msg = `«${tr.transactionId}» tranzaksiya ID bazada allaqachon mavjud`;
          this.addCellError(tr.cellErrors, tr.errors, 'transaction_id', msg);
          this.addCellError(
            row.cellErrors,
            row.errors,
            'link_code',
            `2-sahifa (${tr.rowNumber}-qator): ${msg}`,
          );
          row.status = 'ERROR';
        } else {
          const prevOwner = seenFileTxIds.get(tr.transactionId);
          if (prevOwner) {
            const msg = `«${tr.transactionId}» tranzaksiya ID ushbu faylda (${prevOwner}) takrorlangan`;
            this.addCellError(tr.cellErrors, tr.errors, 'transaction_id', msg);
            this.addCellError(
              row.cellErrors,
              row.errors,
              'link_code',
              `2-sahifa (${tr.rowNumber}-qator): ${msg}`,
            );
            row.status = 'ERROR';
          } else {
            seenFileTxIds.set(tr.transactionId, `2-sahifa ${tr.rowNumber}-qator`);
          }
        }
      }

      // Avvalgi ariza raqamini (parent_application_number) tekshirish
      if (row.parentApplicationNumber && row.repeatType !== ApplicationRepeatType.PRIMARY) {
        const pLower = row.parentApplicationNumber.trim().toLowerCase();
        const dbParentId = dbAppIdByNumLower.get(pLower);
        if (dbParentId) {
          row.parentApplicationId = dbParentId;
        } else if (!seenFileAppNumbers.has(pLower)) {
          this.addCellError(
            row.cellErrors,
            row.errors,
            'parent_application_number',
            `«${row.parentApplicationNumber}» avvalgi ariza raqami bazada (yoki yuqori qatorlarda) topilmadi`,
          );
          row.status = 'ERROR';
        }
      }

      // Agar qatorda validatsiya xatosi bo'lsa, uni ERROR holatida qoldiramiz
      if (row.status === 'ERROR') {
        continue;
      }

      // 1-darajali dublikat tekshiruvi (application_number)
      if (row.applicationNumber) {
        const lowerNum = row.applicationNumber.trim().toLowerCase();
        if (dbAppIdByNumLower.has(lowerNum)) {
          row.status = 'DUPLICATE';
          row.duplicateReason = `«${row.applicationNumber}» raqamli ariza bazada allaqachon mavjud`;
          continue;
        }
        const prevRowNum = seenFileAppNumbers.get(lowerNum);
        if (prevRowNum !== undefined) {
          row.status = 'DUPLICATE';
          row.duplicateReason = `«${row.applicationNumber}» raqamli ariza ushbu faylning ${prevRowNum}-qatorida allaqachon mavjud`;
          continue;
        }
        seenFileAppNumbers.set(lowerNum, row.rowNumber);
      } else if (row.date) {
        // 2-darajali dublikat tekshiruvi (raqamsiz arizalar uchun)
        const citizenKey = row.matchedCitizenId
          ? `cid:${row.matchedCitizenId}`
          : row.citizenPassport
            ? `pass:${row.citizenPassport}`
            : row.citizenPinfl
              ? `pinfl:${row.citizenPinfl}`
              : `phone:${row.citizenPhone || ''}`;

        const fp = this.buildTier2Fingerprint({
          citizenKey,
          date: row.date,
          crimeId: row.crimeId,
          repeatType: row.repeatType,
          parentRef: row.parentApplicationId || row.parentApplicationNumber,
          amount: row.transferAmount,
          description: row.description,
        });

        const existingMatch = dbFingerprints.get(fp);
        if (existingMatch) {
          row.status = 'DUPLICATE';
          row.duplicateReason = `Xuddi shu fuqaro, sana (${row.date}), jinoyat va zarar/fabula bo'yicha ariza bazada allaqachon mavjud (№ ${existingMatch})`;
          continue;
        }
        const prevFileRow = seenFileFingerprints.get(fp);
        if (prevFileRow !== undefined) {
          row.status = 'DUPLICATE';
          row.duplicateReason = `Ushbu qator faylning ${prevFileRow}-qatori bilan aynan bir xil (dublikat)`;
          continue;
        }
        seenFileFingerprints.set(fp, row.rowNumber);
      }
    }
  }

  private buildFailedExportPayload(
    analysis: ParsedWorkbookAnalysis,
    extraRuntimeFailedRows: ParsedApplicationRow[] = [],
  ): FailedRowExportPayload {
    const failedAppSet = new Set<ParsedApplicationRow>([
      ...analysis.rows.filter((r) => r.status === 'ERROR'),
      ...extraRuntimeFailedRows,
    ]);
    const failedApps = Array.from(failedAppSet).sort((a, b) => a.rowNumber - b.rowNumber);

    const applications = failedApps.map((r) => ({
      rawValues: r.rawValues,
      cellErrors: r.cellErrors,
      rowErrors: r.errors,
    }));

    const extraTransfers: FailedRowExportPayload['extraTransfers'] = [];
    const suspectClues: FailedRowExportPayload['suspectClues'] = [];

    for (const app of failedApps) {
      for (const tr of app.extraTransfers) {
        extraTransfers.push({
          rawValues: tr.rawValues,
          cellErrors: tr.cellErrors,
          rowErrors:
            tr.errors.length > 0
              ? tr.errors
              : [`Asosiy ariza (${app.rowNumber}-qator) xatolik sababli bazaga yozilmadi`],
        });
      }
      for (const clue of app.suspectClues) {
        suspectClues.push({
          rawValues: clue.rawValues,
          cellErrors: clue.cellErrors,
          rowErrors:
            clue.errors.length > 0
              ? clue.errors
              : [`Asosiy ariza (${app.rowNumber}-qator) xatolik sababli bazaga yozilmadi`],
        });
      }
    }

    for (const orphanTr of analysis.orphanTransfers) {
      extraTransfers.push({
        rawValues: orphanTr.rawValues,
        cellErrors: orphanTr.cellErrors,
        rowErrors: orphanTr.errors,
      });
    }

    for (const orphanClue of analysis.orphanSuspects) {
      suspectClues.push({
        rawValues: orphanClue.rawValues,
        cellErrors: orphanClue.cellErrors,
        rowErrors: orphanClue.errors,
      });
    }

    return { applications, extraTransfers, suspectClues };
  }

  async preview(
    fileBuffer: Buffer,
    currentUser?: JwtAccessPayload,
  ): Promise<ImportPreviewResponse> {
    const analysis = await this.analyzeWorkbook(fileBuffer, currentUser);

    const previewRows: ImportPreviewRow[] = analysis.rows.map((r) => {
      const cellErrorsList: ImportCellError[] = [];
      for (const [colKey, msgs] of r.cellErrors.entries()) {
        for (const msg of msgs) {
          cellErrorsList.push({
            sheet: 'APPLICATIONS',
            rowNumber: r.rowNumber,
            columnKey: colKey,
            message: msg,
          });
        }
      }
      for (const tr of r.extraTransfers) {
        for (const [colKey, msgs] of tr.cellErrors.entries()) {
          for (const msg of msgs) {
            cellErrorsList.push({
              sheet: 'EXTRA_TRANSFERS',
              rowNumber: tr.rowNumber,
              columnKey: colKey,
              message: msg,
            });
          }
        }
      }
      for (const cl of r.suspectClues) {
        for (const [colKey, msgs] of cl.cellErrors.entries()) {
          for (const msg of msgs) {
            cellErrorsList.push({
              sheet: 'SUSPECT_CLUES',
              rowNumber: cl.rowNumber,
              columnKey: colKey,
              message: msg,
            });
          }
        }
      }

      const extraAmountSum = r.extraTransfers.reduce((acc, t) => acc + Number(t.amount || 0), 0);
      const totalAmount = Number(r.transferAmount || 0) + extraAmountSum;
      const hasPrimaryTransfer = Boolean(
        r.transferAmount || r.receiverCardNumber || r.destinationLabel || r.transferDate,
      );

      return {
        rowNumber: r.rowNumber,
        linkCode: r.linkCode,
        applicationNumber: r.applicationNumber,
        date: r.date,
        districtName: r.districtName,
        citizenFullName:
          [r.citizenLastName, r.citizenFirstName, r.citizenMiddleName].filter(Boolean).join(' ') ||
          null,
        citizenIdentifier: r.citizenPassport || r.citizenPinfl || r.citizenPhone || null,
        crimeLabel: r.crimeLabel,
        totalAmount,
        currency: r.transferCurrency,
        transfersCount: (hasPrimaryTransfer ? 1 : 0) + r.extraTransfers.length,
        suspectCluesCount: r.suspectClues.length,
        status: r.status,
        duplicateReason: r.duplicateReason,
        matchedExistingCitizen: Boolean(r.matchedCitizenId),
        matchedExistingCards: r.matchedCards,
        errors: r.errors,
        cellErrors: cellErrorsList,
        warnings: r.warnings,
      };
    });

    const orphanErrors: ImportOrphanRowError[] = [
      ...analysis.orphanTransfers.map((t) => ({
        sheet: 'EXTRA_TRANSFERS' as const,
        rowNumber: t.rowNumber,
        appRef: t.appRef || null,
        message: t.errors.join('; '),
        columnKey: 'app_ref',
      })),
      ...analysis.orphanSuspects.map((s) => ({
        sheet: 'SUSPECT_CLUES' as const,
        rowNumber: s.rowNumber,
        appRef: s.appRef || null,
        message: s.errors.join('; '),
        columnKey: 'app_ref',
      })),
    ];

    const readyCount = previewRows.filter((r) => r.status === 'READY').length;
    const duplicateCount = previewRows.filter((r) => r.status === 'DUPLICATE').length;
    const errorCount = previewRows.filter((r) => r.status === 'ERROR').length;

    return {
      templateValid: analysis.templateValid,
      totalRows: previewRows.length,
      readyCount,
      duplicateCount,
      errorCount,
      orphanErrorsCount: orphanErrors.length,
      ignoredExtraColumns: analysis.ignoredExtraColumns,
      rows: previewRows,
      orphanErrors,
    };
  }

  async generateErrorReportFromFile(
    fileBuffer: Buffer,
    currentUser?: JwtAccessPayload,
  ): Promise<ExcelJS.Workbook> {
    const analysis = await this.analyzeWorkbook(fileBuffer, currentUser);
    const payload = this.buildFailedExportPayload(analysis);
    if (
      payload.applications.length === 0 &&
      payload.extraTransfers.length === 0 &&
      payload.suspectClues.length === 0
    ) {
      throw new BadRequestException('Faylda xatoli qatorlar mavjud emas');
    }
    return this.templateService.generateErrorReportWorkbook(payload, currentUser);
  }

  private async upsertCitizenInTx(
    manager: EntityManager,
    row: ParsedApplicationRow,
  ): Promise<Citizen> {
    const citizenRepo = manager.getRepository(Citizen);
    let existing: Citizen | null = null;

    if (row.citizenPassport) {
      existing = await citizenRepo.findOne({ where: { passport: row.citizenPassport } });
    }
    if (!existing && row.citizenPinfl) {
      existing = await citizenRepo.findOne({ where: { pinfl: row.citizenPinfl } });
    }
    if (!existing && row.citizenPhone) {
      existing = await citizenRepo.findOne({ where: { phone_number: row.citizenPhone } });
    }

    if (existing) {
      // Mavjud tasdiqlangan ma'lumotlarni buzmasdan faqat bo'sh maydonlarni to'ldiramiz
      let changed = false;
      if (row.citizenFirstName && !existing.first_name) {
        existing.first_name = row.citizenFirstName;
        changed = true;
      }
      if (row.citizenLastName && !existing.last_name) {
        existing.last_name = row.citizenLastName;
        changed = true;
      }
      if (row.citizenMiddleName && !existing.middle_name) {
        existing.middle_name = row.citizenMiddleName;
        changed = true;
      }
      if (row.citizenPassport && !existing.passport) {
        existing.passport = row.citizenPassport;
        changed = true;
      }
      if (row.citizenPinfl && !existing.pinfl) {
        existing.pinfl = row.citizenPinfl;
        changed = true;
      }
      if (row.citizenPhone && !existing.phone_number) {
        existing.phone_number = row.citizenPhone;
        changed = true;
      }
      if (row.citizenBirthDate && !existing.birth_date) {
        existing.birth_date = row.citizenBirthDate;
        changed = true;
      }
      if (row.citizenGender && !existing.gender) {
        existing.gender = row.citizenGender;
        changed = true;
      }
      if (row.citizenAddress && !existing.address) {
        existing.address = row.citizenAddress;
        changed = true;
      }
      if (row.citizenDistrictId && !existing.district_id) {
        existing.district_id = row.citizenDistrictId;
        changed = true;
      }
      if (row.citizenNeighborhoodId && !existing.neighborhood_id) {
        existing.neighborhood_id = row.citizenNeighborhoodId;
        changed = true;
      }
      if (row.occupationCategoryId && !existing.occupation_category_id) {
        existing.occupation_category_id = row.occupationCategoryId;
        changed = true;
      }
      if (row.occupationId && !existing.occupation_id) {
        existing.occupation_id = row.occupationId;
        changed = true;
      }
      if (row.workplaceId && !existing.workplace_id) {
        existing.workplace_id = row.workplaceId;
        changed = true;
      }
      if (row.workPosition && !existing.work_position) {
        existing.work_position = row.workPosition;
        changed = true;
      }
      return changed ? citizenRepo.save(existing) : existing;
    }

    const created = citizenRepo.create({
      first_name: row.citizenFirstName,
      last_name: row.citizenLastName,
      middle_name: row.citizenMiddleName,
      passport: row.citizenPassport,
      pinfl: row.citizenPinfl,
      phone_number: row.citizenPhone,
      birth_date: row.citizenBirthDate,
      gender: row.citizenGender,
      address: row.citizenAddress,
      district_id: row.citizenDistrictId,
      neighborhood_id: row.citizenNeighborhoodId,
      occupation_category_id: row.occupationCategoryId,
      occupation_id: row.occupationId,
      workplace_id: row.workplaceId,
      work_position: row.workPosition,
    });
    return citizenRepo.save(created);
  }

  private async upsertCardInTx(
    manager: EntityManager,
    params: {
      cardNumber: string;
      bankId: string | null;
      fullName: string | null;
      citizenId: string | null;
    },
  ): Promise<Card> {
    const cardRepo = manager.getRepository(Card);
    const existing = await cardRepo.findOne({ where: { card_number: params.cardNumber } });
    if (existing) {
      let changed = false;
      if (params.fullName && !existing.full_name) {
        existing.full_name = params.fullName;
        changed = true;
      }
      if (params.bankId && !existing.bank_id) {
        existing.bank_id = params.bankId;
        changed = true;
      }
      if (params.citizenId && !existing.citizen_id) {
        existing.citizen_id = params.citizenId;
        changed = true;
      }
      return changed ? cardRepo.save(existing) : existing;
    }

    const created = cardRepo.create({
      card_number: params.cardNumber,
      bank_id: params.bankId,
      full_name: params.fullName,
      citizen_id: params.citizenId,
    });
    return cardRepo.save(created);
  }

  private async resolveChainInTx(
    txAppRepo: Repository<Application>,
    repeatType: ApplicationRepeatType,
    parentApplicationId: string | null,
  ): Promise<{
    repeat_type: ApplicationRepeatType;
    parent_application_id: string | null;
    root_application_id: string | null;
    repeat_sequence: number;
  }> {
    if (repeatType === ApplicationRepeatType.PRIMARY) {
      return {
        repeat_type: ApplicationRepeatType.PRIMARY,
        parent_application_id: null,
        root_application_id: null,
        repeat_sequence: 1,
      };
    }

    if (!parentApplicationId) {
      return {
        repeat_type: repeatType,
        parent_application_id: null,
        root_application_id: null,
        repeat_sequence: 2,
      };
    }

    const parent = await txAppRepo.findOne({
      where: { id: parentApplicationId, is_deleted: false },
      select: { id: true, root_application_id: true, repeat_sequence: true },
    });
    if (!parent) {
      return {
        repeat_type: repeatType,
        parent_application_id: null,
        root_application_id: null,
        repeat_sequence: 2,
      };
    }

    const rootId = resolveRootApplicationId(parent);
    const maxSeqRaw = await txAppRepo
      .createQueryBuilder('a')
      .select('COALESCE(MAX(a.repeat_sequence), 1)', 'maxSeq')
      .where('a.is_deleted = false')
      .andWhere('(a.id = :rootId OR a.root_application_id = :rootId)', { rootId })
      .getRawOne<{ maxSeq?: string | number }>();

    return {
      repeat_type: repeatType,
      parent_application_id: parent.id,
      root_application_id: rootId,
      repeat_sequence: computeNextRepeatSequence(Number(maxSeqRaw?.maxSeq || 1)),
    };
  }

  async commit(
    fileBuffer: Buffer,
    options: { skipErrors?: boolean },
    currentUser?: JwtAccessPayload,
  ): Promise<ImportCommitResponse> {
    const analysis = await this.analyzeWorkbook(fileBuffer, currentUser);
    const skipErrors = options.skipErrors !== false;

    const initialErrorsCount = analysis.rows.filter((r) => r.status === 'ERROR').length;
    if (
      !skipErrors &&
      (initialErrorsCount > 0 ||
        analysis.orphanTransfers.length > 0 ||
        analysis.orphanSuspects.length > 0)
    ) {
      throw new BadRequestException(
        `Faylda ${initialErrorsCount} ta xatoli ariza qatori mavjud. Avval xatolarni tuzating yoki 'Xatoli qatorlarni o'tkazib yuborish' rejimidan foydalaning.`,
      );
    }

    const createdApplications: ImportCommitResponse['createdApplications'] = [];
    const skippedDuplicates: ImportCommitResponse['skippedDuplicates'] = [];
    const failedRowsSummary: ImportCommitResponse['failedRows'] = [];
    const runtimeFailedRows: ParsedApplicationRow[] = [];
    const createdByAppNumLower = new Map<string, string>();
    const createdIds: string[] = [];

    for (const row of analysis.rows) {
      if (row.status === 'DUPLICATE') {
        skippedDuplicates.push({
          rowNumber: row.rowNumber,
          application_number: row.applicationNumber,
          reason: row.duplicateReason || 'Dublikat ariza',
        });
        continue;
      }

      if (row.status === 'ERROR') {
        failedRowsSummary.push({
          rowNumber: row.rowNumber,
          application_number: row.applicationNumber,
          errors: row.errors,
        });
        continue;
      }

      // Avvalgi ariza shu faylning yuqori qatorida yaratilgan bo'lsa ID ni bog'laymiz
      if (
        !row.parentApplicationId &&
        row.parentApplicationNumber &&
        row.repeatType !== ApplicationRepeatType.PRIMARY
      ) {
        const createdParentId = createdByAppNumLower.get(
          row.parentApplicationNumber.trim().toLowerCase(),
        );
        if (createdParentId) {
          row.parentApplicationId = createdParentId;
        }
      }

      try {
        const saved = await this.applicationRepo.manager.transaction(async (manager) => {
          const txAppRepo = manager.getRepository(Application);
          const txTransferRepo = manager.getRepository(Transfer);
          const txCustomFieldRepo = manager.getRepository(ApplicationCustomField);
          const txHistoryRepo = manager.getRepository(ApplicationStatusHistory);

          // 1. Fuqaro (deduplikatsiya bilan)
          const citizen = await this.upsertCitizenInTx(manager, row);

          // 2. Asosiy jabrlanuvchi kartasi (deduplikatsiya bilan)
          let primaryVictimCardId: string | null = null;
          if (row.victimCardNumber) {
            const fullName =
              row.victimCardFullName ||
              [citizen.last_name, citizen.first_name, citizen.middle_name]
                .filter(Boolean)
                .join(' ') ||
              null;
            const victimCard = await this.upsertCardInTx(manager, {
              cardNumber: row.victimCardNumber,
              bankId: row.victimBankId,
              fullName,
              citizenId: citizen.id,
            });
            primaryVictimCardId = victimCard.id;
          }

          // 3. Asosiy o'tkazma (agar to'ldirilgan bo'lsa)
          let primaryTransferId: string | null = null;
          const hasPrimaryTransfer = Boolean(
            row.transferAmount ||
            row.receiverCardNumber ||
            row.destinationLabel ||
            row.transferDate,
          );
          if (hasPrimaryTransfer) {
            let receiverCardId: string | null = null;
            if (row.receiverCardNumber) {
              const recCard = await this.upsertCardInTx(manager, {
                cardNumber: row.receiverCardNumber,
                bankId: row.receiverBankId,
                fullName: row.receiverCardFullName,
                citizenId: null,
              });
              receiverCardId = recCard.id;
            }

            const tr = txTransferRepo.create({
              transaction_id: row.transactionId,
              amount: row.transferAmount,
              currency: row.transferCurrency || 'UZS',
              payment_provider_id: row.paymentProviderId,
              sender_card_id: primaryVictimCardId,
              receiver_card_id: receiverCardId,
              destination_type: row.destinationType,
              destination_label: row.destinationLabel,
              transfer_date: row.transferDate,
              transfer_time: row.transferTime,
            });
            const savedTr = await txTransferRepo.save(tr);
            primaryTransferId = savedTr.id;
          }

          // 4. Protsessual muddat va zanjir
          const statusObj = row.statusObj;
          const baseDate = row.date ? new Date(`${row.date}T00:00:00.000Z`) : new Date();
          const effectiveSlaDays = row.slaDays ?? statusObj?.default_sla_days ?? 10;
          let computedDeadline: Date | null = null;
          if (!statusObj || statusObj.tracks_sla) {
            computedDeadline = new Date(
              baseDate.getTime() + effectiveSlaDays * 24 * 60 * 60 * 1000,
            );
          }
          const isClosedStatus = statusObj?.category === ApplicationStatusCategory.CLOSED;
          const chainResolved = await this.resolveChainInTx(
            txAppRepo,
            row.repeatType,
            row.parentApplicationId,
          );

          // 5. Gumonlanuvchi izlari (3-sahifa -> suspect_tree)
          const suspectTree: SuspectTreeNode[] = row.suspectClues
            .filter((c) => c.fieldKey && c.value)
            .map(
              (c) =>
                ({
                  id: crypto.randomUUID(),
                  field_key: c.fieldKey!,
                  field_label: c.fieldLabel || c.fieldKey!,
                  label: c.fieldLabel || c.fieldKey!,
                  value: c.value!,
                  ...(c.note ? { note: c.note } : {}),
                }) as unknown as SuspectTreeNode,
            );

          // 6. Ariza yozuvini saqlash
          const appEntity = txAppRepo.create({
            application_number: row.applicationNumber,
            date: baseDate,
            status_id: row.statusId,
            status: row.statusCode || 'YANGI',
            district_id: row.districtId,
            source_id: row.sourceId,
            department_service_id: row.departmentServiceId,
            appeal_type: row.appealType,
            submission_form: row.submissionForm,
            applicant_type: row.applicantType,
            ...chainResolved,
            repeat_reason: row.repeatReason,
            crime_id: row.crimeId,
            crime_method_id: row.crimeMethodId,
            awareness_status_id: row.awarenessStatusId,
            awareness_note: row.awarenessNote,
            citizen_id: citizen.id,
            workplace_id: row.workplaceId,
            work_position: row.workPosition,
            card_id: primaryVictimCardId,
            transfer_id: primaryTransferId,
            sla_days: effectiveSlaDays,
            deadline_at: computedDeadline,
            decision_type_id: row.decisionTypeId,
            decision_number: row.decisionNumber,
            decision_date: row.decisionDate ? new Date(`${row.decisionDate}T00:00:00.000Z`) : null,
            rejection_reason_id: row.rejectionReasonId,
            description: row.description,
            officer_notes: row.officerNotes,
            suspect_tree: suspectTree,
            closed_at: isClosedStatus ? new Date() : null,
            created_by_id: analysis.creatorUserId,
            is_deleted: false,
          });
          const savedApp = await txAppRepo.save(appEntity);

          if (primaryTransferId) {
            await txTransferRepo.update(primaryTransferId, { application_id: savedApp.id });
          }

          // 7. Qo'shimcha o'tkazmalar (2-sahifa -> transfers + application_custom_fields)
          for (let idx = 0; idx < row.extraTransfers.length; idx++) {
            const extra = row.extraTransfers[idx];
            let senderCardId = primaryVictimCardId;
            if (extra.victimCardNumber) {
              const sCard = await this.upsertCardInTx(manager, {
                cardNumber: extra.victimCardNumber,
                bankId: extra.victimBankId,
                fullName: null,
                citizenId: citizen.id,
              });
              senderCardId = sCard.id;
            }

            let recCardId: string | null = null;
            if (extra.receiverCardNumber) {
              const rCard = await this.upsertCardInTx(manager, {
                cardNumber: extra.receiverCardNumber,
                bankId: extra.receiverBankId,
                fullName: extra.receiverCardFullName,
                citizenId: null,
              });
              recCardId = rCard.id;
            }

            const extraTransfer = await txTransferRepo.save(
              txTransferRepo.create({
                transaction_id: extra.transactionId,
                amount: extra.amount,
                currency: extra.currency || 'UZS',
                payment_provider_id: extra.paymentProviderId,
                sender_card_id: senderCardId,
                receiver_card_id: recCardId,
                destination_type: extra.destinationType,
                destination_label: extra.destinationLabel,
                transfer_date: extra.transferDate,
                transfer_time: extra.transferTime,
                application_id: savedApp.id,
              }),
            );

            await txCustomFieldRepo.save(
              txCustomFieldRepo.create({
                application_id: savedApp.id,
                label: `${idx + 2}-o'tkazma`,
                key: `extra_transfer_${idx + 1}`,
                type: CustomFieldType.TRANSFER,
                transfer_id: extraTransfer.id,
                card_id: senderCardId,
                order: idx + 1,
              }),
            );
          }

          // 8. Status tarixi
          await txHistoryRepo.save(
            txHistoryRepo.create({
              application_id: savedApp.id,
              action: 'CREATED',
              to_status_id: statusObj?.id || row.statusId || null,
              to_status_name: statusObj?.name || savedApp.status || 'Yangi',
              new_deadline_at: computedDeadline,
              note: "Excel import orqali ro'yxatga olindi",
              changed_by_id: analysis.creatorUserId,
            }),
          );

          return {
            id: savedApp.id,
            application_number: savedApp.application_number,
            citizen_name:
              [citizen.last_name, citizen.first_name, citizen.middle_name]
                .filter(Boolean)
                .join(' ') || null,
          };
        });

        createdIds.push(saved.id);
        if (saved.application_number) {
          createdByAppNumLower.set(saved.application_number.trim().toLowerCase(), saved.id);
        }
        createdApplications.push({
          id: saved.id,
          rowNumber: row.rowNumber,
          application_number: saved.application_number,
          citizen_name: saved.citizen_name,
        });
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          skippedDuplicates.push({
            rowNumber: row.rowNumber,
            application_number: row.applicationNumber,
            reason: 'Bir vaqtda yuklash natijasida unikal cheklov (dublikat) aniqlandi',
          });
        } else {
          const errMsg = err instanceof Error ? err.message : 'Saqlashda kutilmagan xatolik';
          this.logger.warn(`Excel import ${row.rowNumber}-qator xatosi: ${errMsg}`);
          this.addCellError(row.cellErrors, row.errors, 'application_number', errMsg);
          row.status = 'ERROR';
          runtimeFailedRows.push(row);
          failedRowsSummary.push({
            rowNumber: row.rowNumber,
            application_number: row.applicationNumber,
            errors: row.errors,
          });
        }
      }
    }

    // Post-commit sinxronizatsiya (Intelligence + SLA — Telegram flood qilmasdan)
    for (const appId of createdIds) {
      try {
        await this.intelligenceSync.syncApplicationById(appId);
      } catch (err) {
        this.logger.warn(
          `IntelligenceSync xatosi (${appId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      void this.slaQueueService.scheduleForApplication(appId);
    }

    // Agar bazaga yozilmay qolgan xatoli qatorlar bo'lsa -> qizil katakli qayta yuklanuvchi Excel yaratish
    let errorReportBase64: string | null = null;
    let errorReportFileName: string | null = null;
    const failedPayload = this.buildFailedExportPayload(analysis, runtimeFailedRows);
    const hasFailedExport =
      failedPayload.applications.length > 0 ||
      failedPayload.extraTransfers.length > 0 ||
      failedPayload.suspectClues.length > 0;

    if (hasFailedExport) {
      const errorWb = await this.templateService.generateErrorReportWorkbook(
        failedPayload,
        currentUser,
      );
      const rawBuf = await errorWb.xlsx.writeBuffer();
      errorReportBase64 = Buffer.from(rawBuf).toString('base64');
      const today = new Date().toISOString().slice(0, 10);
      errorReportFileName = `Xatoli_qatorlar_${today}.xlsx`;
    }

    return {
      totalRows: analysis.rows.length,
      createdCount: createdApplications.length,
      skippedDuplicateCount: skippedDuplicates.length,
      failedCount: failedRowsSummary.length,
      createdApplications,
      skippedDuplicates,
      failedRows: failedRowsSummary,
      errorReportBase64,
      errorReportFileName,
    };
  }
}
