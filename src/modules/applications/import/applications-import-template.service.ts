import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { In, Repository } from 'typeorm';

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
import { TransferDestinationType } from '../../../common/enums/transfer-destination-type.enum';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../../common/utils/district-scope.util';
import {
  DESTINATION_TYPE_LABELS,
  sanitizeExcelValue,
} from '../../../common/utils/excel-style.util';
import { User } from '../../users/user.entity';
import { AwarenessStatus } from '../awareness-statuses/awareness-status.entity';
import { Crime } from '../crimes/crime.entity';
import { CrimeMethod } from '../crimes/methods/crime-method.entity';
import { DecisionType } from '../decision-types/decision-type.entity';
import { DepartmentService } from '../department-services/department-service.entity';
import { District } from '../districts/district.entity';
import { Neighborhood } from '../neighborhoods/neighborhood.entity';
import { Occupation } from '../occupations/occupation.entity';
import { OccupationCategory } from '../occupations/occupation-category.entity';
import { RejectionReason } from '../rejection-reasons/rejection-reason.entity';
import { ApplicationSource } from '../sources/application-source.entity';
import { ApplicationStatus } from '../statuses/application-status.entity';
import { SuspectFieldConfig } from '../suspect-fields/suspect-field-config.entity';
import { Bank } from '../transfers/banks/bank.entity';
import { PaymentProvider } from '../transfers/payment_providers/payment_provider.entity';
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
  IMPORT_TEMPLATE_SIGNATURE,
  type ImportColumnDef,
  type ImportDropdownKey,
  SHEET_NAMES,
  SUSPECT_CLUE_IMPORT_COLUMNS,
} from './applications-import.types';

const GROUP_HEADER_COLORS: Record<ImportColumnDef['group'], { bg: string; fg: string }> = {
  core: { bg: 'FF1E3A5F', fg: 'FFFFFFFF' },
  classification: { bg: 'FF312E81', fg: 'FFFFFFFF' },
  citizen: { bg: 'FF065F46', fg: 'FFFFFFFF' },
  finance: { bg: 'FF7C2D12', fg: 'FFFFFFFF' },
  decision: { bg: 'FF4C1D95', fg: 'FFFFFFFF' },
  notes: { bg: 'FF334155', fg: 'FFFFFFFF' },
};

const ERROR_CELL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEE2E2' },
};

const ERROR_CELL_FONT: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 10,
  bold: true,
  color: { argb: 'FF991B1B' },
};

const ERROR_CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'medium', color: { argb: 'FFDC2626' } },
  left: { style: 'medium', color: { argb: 'FFDC2626' } },
  bottom: { style: 'medium', color: { argb: 'FFDC2626' } },
  right: { style: 'medium', color: { argb: 'FFDC2626' } },
};

export interface TemplateDropdownDataset {
  lists: Record<ImportDropdownKey, string[]>;
  sampleDefaults: Partial<Record<string, string>>;
  stats: Array<{ label: string; count: number }>;
}

@Injectable()
export class ApplicationsImportTemplateService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    @InjectRepository(Neighborhood)
    private readonly neighborhoodRepo: Repository<Neighborhood>,
    @InjectRepository(ApplicationStatus)
    private readonly statusRepo: Repository<ApplicationStatus>,
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
  ) {}

  private async loadDropdownDataset(
    currentUser?: JwtAccessPayload,
  ): Promise<TemplateDropdownDataset> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);

    const [
      districts,
      neighborhoods,
      statuses,
      crimes,
      crimeMethods,
      sources,
      deptServices,
      awarenessStatuses,
      occCategories,
      occupations,
      workplaces,
      banks,
      providers,
      decisionTypes,
      rejectionReasons,
      suspectFields,
    ] = await Promise.all([
      allowedDistrictIds !== null
        ? allowedDistrictIds.length > 0
          ? this.districtRepo.find({
              where: { id: In(allowedDistrictIds) },
              order: { name: 'ASC' },
            })
          : Promise.resolve([])
        : this.districtRepo.find({ order: { name: 'ASC' } }),
      allowedDistrictIds !== null
        ? allowedDistrictIds.length > 0
          ? this.neighborhoodRepo.find({
              where: { district_id: In(allowedDistrictIds) },
              relations: { district: true },
              order: { name: 'ASC' },
            })
          : Promise.resolve([])
        : this.neighborhoodRepo.find({
            relations: { district: true },
            order: { name: 'ASC' },
          }),
      this.statusRepo.find({ order: { sort_order: 'ASC', name: 'ASC' } }),
      this.crimeRepo.find({ order: { article: 'ASC' } }),
      this.crimeMethodRepo.find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      }),
      this.sourceRepo.find({ where: { is_active: true }, order: { name: 'ASC' } }),
      this.deptServiceRepo.find({ where: { is_active: true }, order: { name: 'ASC' } }),
      this.awarenessRepo.find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      }),
      this.occCategoryRepo.find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      }),
      this.occupationRepo.find({
        where: { is_active: true },
        relations: { category: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      }),
      this.workplaceRepo.find({
        where: { is_active: true },
        relations: { district: true },
        order: { name: 'ASC' },
      }),
      this.bankRepo.find({ order: { name: 'ASC' } }),
      this.providerRepo.find({ order: { name: 'ASC' } }),
      this.decisionTypeRepo.find({ where: { is_active: true }, order: { name: 'ASC' } }),
      this.rejectionReasonRepo.find({ where: { is_active: true }, order: { name: 'ASC' } }),
      this.suspectFieldRepo.find({
        where: { is_active: true },
        order: { sort_order: 'ASC', label: 'ASC' },
      }),
    ]);

    const filteredWorkplaces =
      allowedDistrictIds !== null
        ? workplaces.filter((w) => !w.district_id || allowedDistrictIds.includes(w.district_id))
        : workplaces;

    const districtNames = districts.map((d) => (d.name || '').trim()).filter(Boolean);
    const neighborhoodLabels = neighborhoods
      .map((n) => {
        const dName = n.district?.name?.trim();
        return dName ? `${dName} — ${n.name.trim()}` : n.name.trim();
      })
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const statusNames = statuses.map((s) => s.name.trim()).filter(Boolean);
    const crimeLabels = crimes
      .map((c) => {
        const art = (c.article || '').trim();
        const title = (c.title || '').trim();
        if (art && title && art.toLowerCase() !== title.toLowerCase()) {
          return `${art} — ${title}`;
        }
        return art || title;
      })
      .filter(Boolean);

    const crimeMethodNames = crimeMethods.map((m) => m.name.trim()).filter(Boolean);
    const sourceNames = sources.map((s) => s.name.trim()).filter(Boolean);
    const deptServiceNames = deptServices.map((d) => d.name.trim()).filter(Boolean);
    const awarenessNames = awarenessStatuses.map((a) => a.name.trim()).filter(Boolean);
    const occCategoryNames = occCategories.map((c) => c.name.trim()).filter(Boolean);
    const occupationLabels = occupations
      .map((o) => {
        const cat = o.category?.name?.trim();
        return cat ? `${cat} — ${o.name.trim()}` : o.name.trim();
      })
      .filter(Boolean);
    const workplaceLabels = filteredWorkplaces
      .map((w) => {
        const dName = w.district?.name?.trim();
        return dName ? `${dName} — ${w.name.trim()}` : w.name.trim();
      })
      .filter(Boolean);
    const bankNames = banks
      .filter((b) => b.is_active !== false && b.name)
      .map((b) => (b.name || '').trim())
      .filter(Boolean);
    const providerNames = providers.map((p) => (p.name || '').trim()).filter(Boolean);
    const decisionTypeNames = decisionTypes.map((d) => d.name.trim()).filter(Boolean);
    const rejectionReasonNames = rejectionReasons.map((r) => r.name.trim()).filter(Boolean);
    const suspectFieldLabels = suspectFields.map((s) => s.label.trim()).filter(Boolean);

    const lists: Record<ImportDropdownKey, string[]> = {
      statuses: statusNames,
      districts: districtNames,
      sources: sourceNames,
      department_services: deptServiceNames,
      appeal_types: Object.values(AppealType).map((k) => APPEAL_TYPE_LABELS[k]),
      submission_forms: Object.values(SubmissionForm).map((k) => SUBMISSION_FORM_LABELS[k]),
      applicant_types: Object.values(ApplicantType).map((k) => APPLICANT_TYPE_LABELS[k]),
      repeat_types: Object.values(ApplicationRepeatType).map((k) => REPEAT_TYPE_LABELS[k]),
      crimes: crimeLabels,
      crime_methods: crimeMethodNames,
      awareness_statuses: awarenessNames,
      genders: [GENDER_LABELS.male, GENDER_LABELS.female],
      neighborhoods: neighborhoodLabels,
      occupation_categories: occCategoryNames,
      occupations: occupationLabels,
      workplaces: workplaceLabels,
      banks: bankNames,
      currencies: [...ALLOWED_CURRENCIES],
      payment_providers: providerNames,
      destination_types: ALLOWED_DESTINATION_TYPES.map((t) => DESTINATION_TYPE_LABELS[t] || t),
      decision_types: decisionTypeNames,
      rejection_reasons: rejectionReasonNames,
      suspect_fields: suspectFieldLabels,
    };

    const defaultStatus =
      statuses.find((s) => s.is_default || s.code === 'YANGI')?.name || statusNames[0] || '';

    const sampleDefaults: Partial<Record<string, string>> = {
      status: defaultStatus,
      district: districtNames[0] || '',
      citizen_district: districtNames[0] || '',
      citizen_neighborhood: neighborhoodLabels[0] || '',
      source: sourceNames[0] || '',
      department_service: deptServiceNames[0] || '',
      crime: crimeLabels[0] || '',
      crime_method: crimeMethodNames[0] || '',
      awareness_status: awarenessNames[0] || '',
      occupation_category: occCategoryNames[0] || '',
      occupation: occupationLabels[0] || '',
      workplace: workplaceLabels[0] || '',
      victim_card_bank: bankNames[0] || '',
      receiver_card_bank: bankNames[1] || bankNames[0] || '',
      payment_provider: providerNames[0] || '',
      field_type: suspectFieldLabels[0] || '',
    };

    const stats: Array<{ label: string; count: number }> = [
      { label: 'Tumanlar', count: districtNames.length },
      { label: 'Mahallalar', count: neighborhoodLabels.length },
      { label: 'Ariza statuslari', count: statusNames.length },
      { label: 'Jinoyat moddalari', count: crimeLabels.length },
      { label: 'Jinoyat sodir etish usullari', count: crimeMethodNames.length },
      { label: 'Murojaat manbalari', count: sourceNames.length },
      { label: 'Sohaviy xizmatlar', count: deptServiceNames.length },
      { label: "Targ'ibot holatlari", count: awarenessNames.length },
      { label: 'Kasb toifalari / Kasblar', count: occupationLabels.length },
      { label: 'Ish joylari / Tashkilotlar', count: workplaceLabels.length },
      { label: 'Banklar', count: bankNames.length },
      { label: "To'lov provayderlari", count: providerNames.length },
      { label: 'Yakuniy qaror turlari', count: decisionTypeNames.length },
      { label: 'Rad etish sabablari', count: rejectionReasonNames.length },
      { label: 'Gumonlanuvchi iz turlari', count: suspectFieldLabels.length },
    ];

    return { lists, sampleDefaults, stats };
  }

  private buildHiddenListsSheet(
    workbook: ExcelJS.Workbook,
    lists: Record<ImportDropdownKey, string[]>,
  ): Map<ImportDropdownKey, string> {
    const ws = workbook.addWorksheet(SHEET_NAMES.LISTS);
    ws.state = 'veryHidden';

    const rangeMap = new Map<ImportDropdownKey, string>();
    const keys = Object.keys(lists) as ImportDropdownKey[];

    keys.forEach((key, idx) => {
      const colNumber = idx + 1;
      const colLetter = ws.getColumn(colNumber).letter;
      ws.getCell(1, colNumber).value = key;
      const values = lists[key];
      values.forEach((val, rowIdx) => {
        ws.getCell(rowIdx + 2, colNumber).value = val;
      });
      if (values.length > 0) {
        const lastRow = values.length + 1;
        rangeMap.set(key, `'${SHEET_NAMES.LISTS}'!$${colLetter}$2:$${colLetter}$${lastRow}`);
      }
    });

    // Shablon imzosi (meta ustun - Z1/AA1 emas, ro'yxatlardan keyingi bo'sh ustun)
    const metaCol = keys.length + 2;
    ws.getCell(1, metaCol).value = 'TEMPLATE_SIGNATURE';
    ws.getCell(2, metaCol).value = IMPORT_TEMPLATE_SIGNATURE;
    ws.getCell(3, metaCol).value = new Date().toISOString();

    return rangeMap;
  }

  private setupDataSheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    columns: ImportColumnDef[],
    dropdownRanges: Map<ImportDropdownKey, string>,
    options: {
      includeSampleRow: boolean;
      sampleDefaults?: Partial<Record<string, string>>;
      appendErrorColumn?: boolean;
      validationStartRow: number;
      validationEndRow: number;
    },
  ): ExcelJS.Worksheet {
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }],
    });

    const allCols: Array<ImportColumnDef & { isErrorCol?: boolean }> = [...columns];
    if (options.appendErrorColumn) {
      allCols.push({
        key: '__error_reason',
        header: ERROR_REASON_HEADER,
        width: 48,
        group: 'notes',
        isErrorCol: true,
      });
    }

    ws.columns = allCols.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
    }));

    // 1-qator: sarlavhalar
    const headerRow = ws.getRow(1);
    headerRow.height = 34;
    allCols.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      const colors = col.isErrorCol
        ? { bg: 'FFDC2626', fg: 'FFFFFFFF' }
        : GROUP_HEADER_COLORS[col.group];
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: colors.fg } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.bg } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });

    // Matn ustunlariga @ format berish (16 xonali karta va 14 xonali JSHSHIR buzilmasligi uchun)
    allCols.forEach((col, i) => {
      if (col.isTextFormat) {
        ws.getColumn(i + 1).numFmt = '@';
      }
    });

    // 2-qator: namuna qatori (faqat bo'sh shablonda)
    if (options.includeSampleRow) {
      const sampleRow = ws.getRow(2);
      sampleRow.height = 24;
      allCols.forEach((col, i) => {
        const cell = sampleRow.getCell(i + 1);
        const fallback = options.sampleDefaults?.[col.key];
        const rawVal =
          col.sampleValue !== undefined && col.sampleValue !== ''
            ? col.sampleValue
            : (fallback ?? '');
        cell.value = rawVal === '' ? null : rawVal;
        if (col.isTextFormat) {
          cell.numFmt = '@';
        }
        cell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF64748B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'dashed', color: { argb: 'FF94A3B8' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
      sampleRow.commit();
    }

    // Excel Data Validation (dropdown) qo'llash
    for (let r = options.validationStartRow; r <= options.validationEndRow; r++) {
      allCols.forEach((col, i) => {
        if (!col.dropdownKey) return;
        const formula = dropdownRanges.get(col.dropdownKey);
        if (!formula) return;
        const cell = ws.getCell(r, i + 1);
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: "Ro'yxatdan tanlang",
          error:
            "Iltimos, ochiladigan ro'yxatdagi bazada mavjud qiymatlardan birini tanlang. Noma'lum qiymat importda rad etiladi.",
        };
      });
    }

    return ws;
  }

  private buildGuideSheet(
    workbook: ExcelJS.Workbook,
    stats: Array<{ label: string; count: number }>,
  ): void {
    const ws = workbook.addWorksheet(SHEET_NAMES.GUIDE);
    ws.columns = [
      { header: "Bo'lim / Maydon", key: 'col1', width: 32 },
      { header: 'Exceldagi qiymat (Tanlanadigan)', key: 'col2', width: 30 },
      { header: 'Tizim kodi (Enum)', key: 'col3', width: 22 },
      { header: 'Izoh va Qoidalar', key: 'col4', width: 64 },
    ];

    const titleRow = ws.getRow(1);
    ws.mergeCells('A1:D1');
    titleRow.height = 32;
    titleRow.getCell(1).value =
      "ARIZALARNI EXCEL ORQALI IMPORT QILISH — YO'RIQNOMA VA ENUMLAR MA'LUMOTNOMASI";
    titleRow.getCell(1).font = {
      name: 'Calibri',
      size: 13,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    titleRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

    const addSectionHeader = (title: string) => {
      const row = ws.addRow([title, '', '', '']);
      ws.mergeCells(`A${row.number}:D${row.number}`);
      row.height = 24;
      row.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E3A5F' } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    };

    const addRuleRow = (a: string, b: string, c: string, d: string) => {
      const row = ws.addRow([a, b, c, d]);
      row.height = 22;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    };

    addSectionHeader('1. ASOSIY TO‘LDIRISH QOIDALARI');
    addRuleRow(
      'Majburiy ustunlar (*)',
      'Ariza sanasi, Tuman, Familiya, Ism, Jinoyat moddasi (yoki Fabula)',
      'REQUIRED',
      'Bundan tashqari, fuqaro uchun kamida bitta identifikator (**): Telefon, Pasport yoki JSHSHIR kiritilishi shart.',
    );
    addRuleRow(
      'Namuna qatori ([NAMUNA])',
      '2-qator kulrang namuna',
      'AUTO-SKIP',
      "2-qatordagi [NAMUNA] qatorini o'chirmasangiz ham tizim uni avtomatik tashlab ketadi. Haqiqiy arizalarni 3-qatordan boshlab kiriting.",
    );
    addRuleRow(
      "Qat'iy ma'lumotnomalar",
      "Faqat dropdown ro'yxatdan tanlang",
      'STRICT',
      "Tuman, Mahalla, Status, Jinoyat moddasi/usuli, Bank, Provayder, Kasb, Ish joyi, Manba, Xizmat, Targ'ibot, Qaror/Rad sabablari bazada mavjud bo'lishi shart — yangi ma'lumotnoma yaratilmaydi.",
    );
    addRuleRow(
      'Dublikat himoyasi',
      "Avtomatik o'tkazib yuboriladi",
      'DEDUP',
      "Ariza raqami bazada bor bo'lsa yoki raqamsiz arizada Fuqaro + Sana + Jinoyat + Zarar mos kelsa dublikat sifatida o'tkazib yuboriladi. Mavjud Fuqaro va 16 xonali Karta bazaga qayta yaratilmasdan biriktiriladi.",
    );
    addRuleRow(
      "Ko'p o'tkazmalar va Izlar",
      '2- va 3-sahifalar (ixtiyoriy)',
      'LINKING',
      "1-sahifadagi 'Bog'lash kodi (№)' (masalan: 1, 2, 3) yoki 'Ariza raqami' ni 2- va 3-sahifalarning 1-ustuniga yozing — ular shu arizaga avtomatik ulanadi.",
    );
    addRuleRow(
      'Sana va Karta formati',
      'YYYY-MM-DD / 16 ta raqam',
      'FORMAT',
      "Sana: 2026-11-25, Vaqt: 14:30. Karta (16 raqam) va JSHSHIR (14 raqam) ustunlari matn (@) formatida sozlangan — oldidan bo'sh joy qo'ymang.",
    );
    addRuleRow(
      'Xatolik hisoboti',
      'Qizil fonli Excel qaytadi',
      'RE-UPLOAD',
      "Agar ba'zi qatorlarda xato bo'lsa, to'g'ri arizalar bazaga yoziladi, xatolilari esa qizil belgilangan Excel bo'lib qaytadi. Qizil kataklarni to'g'irlab aynan o'sha faylni qayta yuklashingiz mumkin.",
    );

    ws.addRow([]);
    addSectionHeader("2. BARCHA ENUM QIYMATLARI (O'ZBEKCHA NOMI VA TIZIM KODI)");
    addRuleRow('Maydon', 'Exceldagi nomi', 'Tizim kodi', 'Qachon tanlanadi');

    for (const val of Object.values(AppealType)) {
      addRuleRow(
        'Murojaat turi',
        APPEAL_TYPE_LABELS[val],
        val,
        val === AppealType.APPEAL
          ? 'Default. Huquq va manfaatlarni himoya qilish / jinoyat haqida xabar'
          : val === AppealType.COMPLAINT
            ? 'Buzilgan huquqlarni tiklash yoki qaror ustidan shikoyat'
            : 'Faoliyatni takomillashtirish yuzasidan taklif',
      );
    }

    for (const val of Object.values(SubmissionForm)) {
      addRuleRow(
        'Murojaat shakli',
        SUBMISSION_FORM_LABELS[val],
        val,
        val === SubmissionForm.WRITTEN
          ? "Default. Qog'oz / pochta orqali yozma ariza"
          : val === SubmissionForm.ORAL
            ? "Shaxsiy qabul, 102/112 qo'ng'iroq"
            : 'my.gov.uz, pm.gov.uz, elektron pochta',
      );
    }

    for (const val of Object.values(ApplicantType)) {
      addRuleRow(
        'Murojaatchi turi',
        APPLICANT_TYPE_LABELS[val],
        val,
        val === ApplicantType.INDIVIDUAL
          ? 'Default. Jismoniy shaxs'
          : val === ApplicantType.COLLECTIVE
            ? '2 va undan ortiq fuqaro jamoaviy murojaati'
            : val === ApplicantType.LEGAL_ENTITY
              ? 'Tashkilot / yuridik shaxs xabari'
              : val === ApplicantType.ANONYMOUS
                ? 'Anonim xabar'
                : 'JPK 324-modda: aybini bo‘yniga olish arzi',
      );
    }

    for (const val of Object.values(ApplicationRepeatType)) {
      addRuleRow(
        'Takroriylik turi',
        REPEAT_TYPE_LABELS[val],
        val,
        val === ApplicationRepeatType.PRIMARY
          ? 'Default. Holat bo‘yicha birlamchi murojaat'
          : val === ApplicationRepeatType.REPEAT
            ? 'Avvalgi arizadan keyin qayta murojaat (Avvalgi ariza raqamini ko‘rsatish tavsiya etiladi)'
            : val === ApplicationRepeatType.DUPLICATE
              ? 'Ayni bir murojaatning boshqa kanaldan kelgan nusxasi'
              : "Avvalgi arizaga qo'shimcha fakt/karta/dalil qo'shish",
      );
    }

    addRuleRow('Jinsi', GENDER_LABELS.male, 'male', 'Erkak jinsli fuqaro');
    addRuleRow('Jinsi', GENDER_LABELS.female, 'female', 'Ayol jinsli fuqaro');

    for (const cur of ALLOWED_CURRENCIES) {
      addRuleRow(
        'Valyuta',
        cur,
        cur,
        cur === 'UZS' ? "Default. O'zbekiston so'mi" : `${cur} valyutasi`,
      );
    }

    for (const dest of ALLOWED_DESTINATION_TYPES) {
      addRuleRow(
        'Chiqish kanali turi',
        DESTINATION_TYPE_LABELS[dest] || dest,
        dest,
        dest === TransferDestinationType.CARD
          ? 'Default. Pul firibgar plastik kartasiga o‘tkazilgan'
          : "Pul plastik kartadan boshqa kanalga chiqqan bo'lsa 'Chiqish manzili' ustunini to'ldiring",
      );
    }

    ws.addRow([]);
    addSectionHeader("3. SHABLONGA YUKLANGAN JONLI BAZA MA'LUMOTNOMALARI");
    addRuleRow("Ma'lumotnoma nomi", 'Mavjud yozuvlar soni', 'Holat', 'Generatsiya vaqti');
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const st of stats) {
      addRuleRow(
        st.label,
        `${st.count} ta`,
        st.count > 0 ? 'Faol (Dropdown ulangan)' : "Bo'sh",
        nowStr,
      );
    }
  }

  async generateTemplateWorkbook(currentUser?: JwtAccessPayload): Promise<ExcelJS.Workbook> {
    const dataset = await this.loadDropdownDataset(currentUser);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'UVD Arizalar Tizimi';
    workbook.created = new Date();
    workbook.modified = new Date();

    const dropdownRanges = this.buildHiddenListsSheet(workbook, dataset.lists);

    // 1-sahifa: Arizalar
    this.setupDataSheet(workbook, SHEET_NAMES.APPLICATIONS, APP_IMPORT_COLUMNS, dropdownRanges, {
      includeSampleRow: true,
      sampleDefaults: dataset.sampleDefaults,
      validationStartRow: 3,
      validationEndRow: IMPORT_MAX_ROWS + 2,
    });

    // 2-sahifa: Qo'shimcha o'tkazmalar
    this.setupDataSheet(
      workbook,
      SHEET_NAMES.EXTRA_TRANSFERS,
      EXTRA_TRANSFER_IMPORT_COLUMNS,
      dropdownRanges,
      {
        includeSampleRow: true,
        sampleDefaults: dataset.sampleDefaults,
        validationStartRow: 3,
        validationEndRow: IMPORT_MAX_ROWS + 2,
      },
    );

    // 3-sahifa: Gumonlanuvchi izlari
    this.setupDataSheet(
      workbook,
      SHEET_NAMES.SUSPECT_CLUES,
      SUSPECT_CLUE_IMPORT_COLUMNS,
      dropdownRanges,
      {
        includeSampleRow: true,
        sampleDefaults: dataset.sampleDefaults,
        validationStartRow: 3,
        validationEndRow: IMPORT_MAX_ROWS + 2,
      },
    );

    // 4-sahifa: Yo'riqnoma va Enumlar
    this.buildGuideSheet(workbook, dataset.stats);

    return workbook;
  }

  /**
   * Bazaga yozilmay qolgan xatoli qatorlarni QAYTA YUKLASHGA TAYYOR shablon ko'rinishida,
   * aynan xato chiqqan kataklarda QIZIL fon + izoh (note) + oxirgi ustunda Xatolik sababi bilan generatsiya qiladi.
   */
  async generateErrorReportWorkbook(
    payload: FailedRowExportPayload,
    currentUser?: JwtAccessPayload,
  ): Promise<ExcelJS.Workbook> {
    const dataset = await this.loadDropdownDataset(currentUser);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'UVD Arizalar Tizimi — Xatolik Hisoboti';
    workbook.created = new Date();
    workbook.modified = new Date();

    const dropdownRanges = this.buildHiddenListsSheet(workbook, dataset.lists);

    const writeFailedSheet = (
      sheetName: string,
      columns: ImportColumnDef[],
      rows: FailedRowExportPayload['applications'],
    ) => {
      const ws = this.setupDataSheet(workbook, sheetName, columns, dropdownRanges, {
        includeSampleRow: false,
        appendErrorColumn: true,
        validationStartRow: 2,
        validationEndRow: Math.max(rows.length + 50, 200),
      });

      const errorColIndex = columns.length + 1;

      rows.forEach((item, idx) => {
        const rowNum = idx + 2;
        const row = ws.getRow(rowNum);
        row.height = 26;

        columns.forEach((col, colIdx) => {
          const cell = row.getCell(colIdx + 1);
          const rawVal = item.rawValues[col.key];
          if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
            cell.value = typeof rawVal === 'string' ? sanitizeExcelValue(rawVal) : rawVal;
          } else {
            cell.value = null;
          }
          if (col.isTextFormat) {
            cell.numFmt = '@';
          }

          const cellErrMessages = item.cellErrors.get(col.key);
          if (cellErrMessages && cellErrMessages.length > 0) {
            cell.fill = ERROR_CELL_FILL;
            cell.font = ERROR_CELL_FONT;
            cell.border = ERROR_CELL_BORDER;
            cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            cell.note = {
              texts: [
                {
                  font: { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF991B1B' } },
                  text: `Xatolik:\n• ${cellErrMessages.join('\n• ')}`,
                },
              ],
            };
          } else {
            cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            };
          }
        });

        // Oxirgi ustun: Xatolik sababi (tuzatib qayta yuklaganda parser bu ustunni e'tiborsiz qoldiradi)
        const errSummaryCell = row.getCell(errorColIndex);
        errSummaryCell.value = sanitizeExcelValue(item.rowErrors.join('; '));
        errSummaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
        errSummaryCell.font = { name: 'Calibri', size: 9.5, color: { argb: 'FF991B1B' } };
        errSummaryCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        errSummaryCell.border = {
          top: { style: 'thin', color: { argb: 'FFFCA5A5' } },
          left: { style: 'medium', color: { argb: 'FFDC2626' } },
          bottom: { style: 'thin', color: { argb: 'FFFCA5A5' } },
          right: { style: 'thin', color: { argb: 'FFFCA5A5' } },
        };

        if (item.rowErrors.length > 1) {
          row.height = Math.min(84, 18 + item.rowErrors.length * 14);
        }
        row.commit();
      });
    };

    writeFailedSheet(SHEET_NAMES.APPLICATIONS, APP_IMPORT_COLUMNS, payload.applications);
    writeFailedSheet(
      SHEET_NAMES.EXTRA_TRANSFERS,
      EXTRA_TRANSFER_IMPORT_COLUMNS,
      payload.extraTransfers,
    );
    writeFailedSheet(SHEET_NAMES.SUSPECT_CLUES, SUSPECT_CLUE_IMPORT_COLUMNS, payload.suspectClues);
    this.buildGuideSheet(workbook, dataset.stats);

    return workbook;
  }
}
