import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';

import { Role } from '../../../common/enums/role.enum';
import { IntelligenceSyncService } from '../../intelligence/intelligence-sync.service';
import { SlaQueueService } from '../../notifications/sla-queue.service';
import { User } from '../../users/user.entity';
import { Application } from '../application.entity';
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
import { ApplicationsImportService } from './applications-import.service';
import {
  APP_IMPORT_COLUMNS,
  ERROR_REASON_HEADER,
  IMPORT_SAMPLE_ROW_MARKER,
  IMPORT_TEMPLATE_SIGNATURE,
  SHEET_NAMES,
} from './applications-import.types';
import { ApplicationsImportTemplateService } from './applications-import-template.service';

const DIST_QARSHI = { id: 'dist-qarshi', name: 'Qarshi sh.' } as District;
const DIST_KITOB = { id: 'dist-kitob', name: 'Kitob' } as District;
const NEIGH_GULISTON = {
  id: 'neigh-guliston',
  name: 'Guliston MFY',
  district_id: 'dist-qarshi',
  district: DIST_QARSHI,
} as Neighborhood;
const STATUS_YANGI = {
  id: 'status-yangi',
  name: 'Yangi',
  code: 'YANGI',
  is_default: true,
  tracks_sla: true,
  default_sla_days: 10,
  category: ApplicationStatusCategory.OPEN,
  sort_order: 1,
} as ApplicationStatusEntity;
const CRIME_168 = {
  id: 'crime-168',
  article: '168-modda',
  title: 'Firibgarlik',
} as Crime;
const METHOD_PHISHING = {
  id: 'method-phish',
  name: 'Soxta havola orqali',
  code: 'PHISHING',
  is_active: true,
  sort_order: 1,
} as CrimeMethod;
const BANK_AGRO = { id: 'bank-agro', name: 'Agrobank', code: 'AGRO', is_active: true } as Bank;
const PROVIDER_CLICK = {
  id: 'prov-click',
  name: 'Click',
  code: 'click',
} as PaymentProvider;
const SUSPECT_TG = {
  id: 'sf-tg',
  key: 'telegram_username',
  label: 'Telegram username',
  is_active: true,
  sort_order: 1,
} as SuspectFieldConfig;

function createMockRepo<T>(rows: T[] = []) {
  return {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x: Record<string, unknown>) => ({ ...x })),
    save: jest.fn((x: Record<string, unknown>) =>
      Promise.resolve({
        id: (x.id as string) || `gen-${Math.random().toString(36).slice(2, 8)}`,
        ...x,
      }),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue({ maxSeq: 1 }),
    })),
    manager: {
      transaction: jest.fn(),
    },
  };
}

describe('ApplicationsImportService & ApplicationsImportTemplateService', () => {
  let templateService: ApplicationsImportTemplateService;
  let importService: ApplicationsImportService;
  let appRepo: ReturnType<typeof createMockRepo<Application>>;
  let userRepo: ReturnType<typeof createMockRepo<User>>;
  let citizenRepo: ReturnType<typeof createMockRepo<Citizen>>;
  let cardRepo: ReturnType<typeof createMockRepo<Card>>;
  let transferRepo: ReturnType<typeof createMockRepo<Transfer>>;
  let districtRepo: ReturnType<typeof createMockRepo<District>>;
  let intelligenceSync: { syncApplicationById: jest.Mock };
  let slaQueueService: { scheduleForApplication: jest.Mock };

  beforeEach(async () => {
    appRepo = createMockRepo<Application>([]);
    userRepo = createMockRepo<User>([]);
    citizenRepo = createMockRepo<Citizen>([]);
    cardRepo = createMockRepo<Card>([]);
    transferRepo = createMockRepo<Transfer>([]);
    districtRepo = createMockRepo<District>([DIST_QARSHI, DIST_KITOB]);

    intelligenceSync = { syncApplicationById: jest.fn().mockResolvedValue(undefined) };
    slaQueueService = { scheduleForApplication: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationsImportTemplateService,
        ApplicationsImportService,
        { provide: getRepositoryToken(Application), useValue: appRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Citizen), useValue: citizenRepo },
        { provide: getRepositoryToken(Card), useValue: cardRepo },
        { provide: getRepositoryToken(Transfer), useValue: transferRepo },
        { provide: getRepositoryToken(District), useValue: districtRepo },
        {
          provide: getRepositoryToken(Neighborhood),
          useValue: createMockRepo<Neighborhood>([NEIGH_GULISTON]),
        },
        {
          provide: getRepositoryToken(ApplicationStatusEntity),
          useValue: createMockRepo<ApplicationStatusEntity>([STATUS_YANGI]),
        },
        { provide: getRepositoryToken(Crime), useValue: createMockRepo<Crime>([CRIME_168]) },
        {
          provide: getRepositoryToken(CrimeMethod),
          useValue: createMockRepo<CrimeMethod>([METHOD_PHISHING]),
        },
        { provide: getRepositoryToken(ApplicationSource), useValue: createMockRepo([]) },
        { provide: getRepositoryToken(DepartmentService), useValue: createMockRepo([]) },
        { provide: getRepositoryToken(AwarenessStatus), useValue: createMockRepo([]) },
        { provide: getRepositoryToken(OccupationCategory), useValue: createMockRepo([]) },
        { provide: getRepositoryToken(Occupation), useValue: createMockRepo([]) },
        { provide: getRepositoryToken(Workplace), useValue: createMockRepo([]) },
        { provide: getRepositoryToken(Bank), useValue: createMockRepo<Bank>([BANK_AGRO]) },
        {
          provide: getRepositoryToken(PaymentProvider),
          useValue: createMockRepo<PaymentProvider>([PROVIDER_CLICK]),
        },
        { provide: getRepositoryToken(DecisionType), useValue: createMockRepo([]) },
        { provide: getRepositoryToken(RejectionReason), useValue: createMockRepo([]) },
        {
          provide: getRepositoryToken(SuspectFieldConfig),
          useValue: createMockRepo<SuspectFieldConfig>([SUSPECT_TG]),
        },
        { provide: IntelligenceSyncService, useValue: intelligenceSync },
        { provide: SlaQueueService, useValue: slaQueueService },
      ],
    }).compile();

    templateService = module.get(ApplicationsImportTemplateService);
    importService = module.get(ApplicationsImportService);
  });

  async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
    const raw = await wb.xlsx.writeBuffer();
    return Buffer.from(raw);
  }

  function findColIdx(ws: ExcelJS.Worksheet, key: string): number {
    const idx = APP_IMPORT_COLUMNS.findIndex((c) => c.key === key);
    if (idx === -1) throw new Error(`Unknown column key ${key}`);
    return idx + 1;
  }

  it('generates a 5-sheet dynamic template with dropdowns, signature, sample row, and RBAC district scoping', async () => {
    const wb = await templateService.generateTemplateWorkbook({
      sub: 'admin-1',
      username: 'admin',
      role: Role.SUPER_ADMIN,
    });

    expect(wb.worksheets.map((s) => s.name)).toEqual([
      SHEET_NAMES.APPLICATIONS,
      SHEET_NAMES.EXTRA_TRANSFERS,
      SHEET_NAMES.SUSPECT_CLUES,
      SHEET_NAMES.GUIDE,
      SHEET_NAMES.LISTS,
    ]);

    const listsWs = wb.getWorksheet(SHEET_NAMES.LISTS)!;
    expect(listsWs.state).toBe('hidden');
    let foundSig = false;
    const maxListCols = listsWs.columnCount;
    for (let c = 1; c <= maxListCols; c++) {
      if (listsWs.getCell(1, c).value === 'TEMPLATE_SIGNATURE') {
        expect(listsWs.getCell(2, c).value).toBe(IMPORT_TEMPLATE_SIGNATURE);
        foundSig = true;
      }
    }
    expect(foundSig).toBe(true);

    const appWs = wb.getWorksheet(SHEET_NAMES.APPLICATIONS)!;
    expect(appWs.getCell(2, 1).value).toBe(IMPORT_SAMPLE_ROW_MARKER);
    const districtCol = findColIdx(appWs, 'district');
    expect(appWs.getCell(3, districtCol).dataValidation?.type).toBe('list');
    expect(String(appWs.getCell(3, districtCol).dataValidation?.formulae?.[0])).toContain(
      SHEET_NAMES.LISTS,
    );

    // DISTRICT_OFFICER faqat o'ziga biriktirilgan tumanni ko'radi
    userRepo.findOne.mockResolvedValueOnce({
      id: 'u-officer',
      auth_id: 'auth-officer',
      assigned_districts: [DIST_QARSHI],
    });
    districtRepo.find.mockResolvedValueOnce([DIST_QARSHI]);

    const officerWb = await templateService.generateTemplateWorkbook({
      sub: 'auth-officer',
      username: 'officer',
      role: Role.DISTRICT_OFFICER,
    });
    const officerLists = officerWb.getWorksheet(SHEET_NAMES.LISTS)!;
    let districtsCol = -1;
    for (let c = 1; c <= officerLists.columnCount; c++) {
      if (officerLists.getCell(1, c).value === 'districts') {
        districtsCol = c;
        break;
      }
    }
    expect(districtsCol).toBeGreaterThan(0);
    expect(officerLists.getCell(2, districtsCol).value).toBe('Qarshi sh.');
    expect(officerLists.getCell(3, districtsCol).value).toBeNull();
  });

  it('skips [NAMUNA] row, ignores extra unknown columns, supports Cyrillic/Latin lookup, and rejects unknown master values strictly', async () => {
    const wb = await templateService.generateTemplateWorkbook();
    const appWs = wb.getWorksheet(SHEET_NAMES.APPLICATIONS)!;

    // Ortiqcha noma'lum ustun qo'shamiz — import uni e'tiborsiz qoldirishi kerak
    const extraCol = APP_IMPORT_COLUMNS.length + 1;
    appWs.getCell(1, extraCol).value = 'Mening shaxsiy izohim';

    // 3-qator: To'g'ri ariza (Krillda tuman yozilgan: "Қарши ш.")
    const row3 = appWs.getRow(3);
    row3.getCell(findColIdx(appWs, 'link_code')).value = '1';
    row3.getCell(findColIdx(appWs, 'application_number')).value = '2026-10001';
    row3.getCell(findColIdx(appWs, 'date')).value = '2026-11-25';
    row3.getCell(findColIdx(appWs, 'district')).value = 'Қарши ш.';
    row3.getCell(findColIdx(appWs, 'crime')).value = '168-modda — Firibgarlik';
    row3.getCell(findColIdx(appWs, 'citizen_last_name')).value = 'Karimov';
    row3.getCell(findColIdx(appWs, 'citizen_first_name')).value = 'Sardor';
    row3.getCell(findColIdx(appWs, 'citizen_phone')).value = '+998901234567';
    row3.getCell(findColIdx(appWs, 'citizen_neighborhood')).value = 'Guliston MFY';
    row3.getCell(findColIdx(appWs, 'victim_card_number')).value = '8600123456789012';
    row3.getCell(findColIdx(appWs, 'victim_card_bank')).value = 'Agrobank';
    row3.getCell(findColIdx(appWs, 'transfer_amount')).value = 2500000;
    row3.getCell(findColIdx(appWs, 'payment_provider')).value = 'Click';
    row3.getCell(findColIdx(appWs, 'description')).value = 'Telegram orqali firibgarlik';
    row3.getCell(extraCol).value = 'Keraksiz ustun qiymati';
    row3.commit();

    // 4-qator: Xatoli ariza (bazada yo'q tuman va noto'g'ri karta raqami)
    const row4 = appWs.getRow(4);
    row4.getCell(findColIdx(appWs, 'link_code')).value = '2';
    row4.getCell(findColIdx(appWs, 'application_number')).value = '2026-10002';
    row4.getCell(findColIdx(appWs, 'date')).value = '2026-11-25';
    row4.getCell(findColIdx(appWs, 'district')).value = 'Nomalum Tuman 99';
    row4.getCell(findColIdx(appWs, 'crime')).value = '168-modda';
    row4.getCell(findColIdx(appWs, 'citizen_last_name')).value = 'Sobirov';
    row4.getCell(findColIdx(appWs, 'citizen_first_name')).value = 'Jasur';
    row4.getCell(findColIdx(appWs, 'citizen_phone')).value = '+998907778899';
    row4.getCell(findColIdx(appWs, 'victim_card_number')).value = '8600123'; // 16 raqam emas!
    row4.commit();

    // 2-sahifa: 1-arizaga bog'langan qo'shimcha o'tkazma
    const trWs = wb.getWorksheet(SHEET_NAMES.EXTRA_TRANSFERS)!;
    const trRow = trWs.getRow(3);
    trRow.getCell(1).value = '1';
    trRow.getCell(4).value = 500000;
    trRow.getCell(5).value = 'UZS';
    trRow.getCell(6).value = 'Click';
    trRow.commit();

    // 3-sahifa: 1-arizaga bog'langan gumonlanuvchi izi
    const sWs = wb.getWorksheet(SHEET_NAMES.SUSPECT_CLUES)!;
    const sRow = sWs.getRow(3);
    sRow.getCell(1).value = '1';
    sRow.getCell(2).value = 'Telegram username';
    sRow.getCell(3).value = '@scammer_uz';
    sRow.commit();

    const preview = await importService.preview(await toBuffer(wb));

    // [NAMUNA] 2-qator tashlab ketilgan bo'lishi kerak -> faqat 2 ta qator (3- va 4-qator)
    expect(preview.totalRows).toBe(2);
    expect(preview.readyCount).toBe(1);
    expect(preview.errorCount).toBe(1);
    expect(preview.ignoredExtraColumns).toContain('Mening shaxsiy izohim');

    const first = preview.rows[0];
    expect(first.status).toBe('READY');
    expect(first.districtName).toBe('Qarshi sh.');
    expect(first.transfersCount).toBe(2); // 1 asosiy + 1 qo'shimcha
    expect(first.totalAmount).toBe(3000000);
    expect(first.suspectCluesCount).toBe(1);

    const second = preview.rows[1];
    expect(second.status).toBe('ERROR');
    expect(second.cellErrors.some((e) => e.columnKey === 'district')).toBe(true);
    expect(second.cellErrors.some((e) => e.columnKey === 'victim_card_number')).toBe(true);
    // Hech qanday yangi master tuman yaratilmaganligini tekshiramiz
    expect(districtRepo.save).not.toHaveBeenCalled();
  });

  it('detects both Tier-1 (application_number) and Tier-2 (numberless fingerprint) duplicates', async () => {
    const wb = await templateService.generateTemplateWorkbook();
    const appWs = wb.getWorksheet(SHEET_NAMES.APPLICATIONS)!;

    // 3-qator: raqamsiz ariza
    const r3 = appWs.getRow(3);
    r3.getCell(findColIdx(appWs, 'date')).value = '2026-11-25';
    r3.getCell(findColIdx(appWs, 'district')).value = 'Qarshi sh.';
    r3.getCell(findColIdx(appWs, 'crime')).value = '168-modda';
    r3.getCell(findColIdx(appWs, 'citizen_last_name')).value = 'Aliyev';
    r3.getCell(findColIdx(appWs, 'citizen_first_name')).value = 'Botir';
    r3.getCell(findColIdx(appWs, 'citizen_phone')).value = '+998901112233';
    r3.getCell(findColIdx(appWs, 'transfer_amount')).value = 1000000;
    r3.commit();

    // 4-qator: 3-qator bilan aynan bir xil (raqamsiz Tier-2 in-file dublikat)
    const r4 = appWs.getRow(4);
    r4.getCell(findColIdx(appWs, 'date')).value = '2026-11-25';
    r4.getCell(findColIdx(appWs, 'district')).value = 'Qarshi sh.';
    r4.getCell(findColIdx(appWs, 'crime')).value = '168-modda';
    r4.getCell(findColIdx(appWs, 'citizen_last_name')).value = 'Aliyev';
    r4.getCell(findColIdx(appWs, 'citizen_first_name')).value = 'Botir';
    r4.getCell(findColIdx(appWs, 'citizen_phone')).value = '901112233'; // normalizatsiya bilan 998901112233 bo'ladi!
    r4.getCell(findColIdx(appWs, 'transfer_amount')).value = 1000000;
    r4.commit();

    // 5-qator va 6-qator: bir xil Ariza raqami (Tier-1 in-file dublikat)
    for (const rowIdx of [5, 6]) {
      const row = appWs.getRow(rowIdx);
      row.getCell(findColIdx(appWs, 'application_number')).value = '2026-55555';
      row.getCell(findColIdx(appWs, 'date')).value = '2026-11-25';
      row.getCell(findColIdx(appWs, 'district')).value = 'Kitob';
      row.getCell(findColIdx(appWs, 'crime')).value = '168-modda';
      row.getCell(findColIdx(appWs, 'citizen_last_name')).value = 'Toshmatov';
      row.getCell(findColIdx(appWs, 'citizen_first_name')).value = 'Rustam';
      row.getCell(findColIdx(appWs, 'citizen_phone')).value = '+998912223344';
      row.commit();
    }

    const preview = await importService.preview(await toBuffer(wb));
    expect(preview.totalRows).toBe(4);
    expect(preview.readyCount).toBe(2);
    expect(preview.duplicateCount).toBe(2);
    expect(preview.rows[1].status).toBe('DUPLICATE');
    expect(preview.rows[3].status).toBe('DUPLICATE');
  });

  it('commits valid rows atomically and returns a re-uploadable error Excel with red background on exact error cells', async () => {
    const txCitizenRepo = createMockRepo<Citizen>([]);
    const txCardRepo = createMockRepo<Card>([]);
    const txTransferRepo = createMockRepo<Transfer>([]);
    const txAppRepo = createMockRepo<Application>([]);
    const txCustomFieldRepo = createMockRepo<ApplicationCustomField>([]);
    const txHistoryRepo = createMockRepo<ApplicationStatusHistory>([]);

    const repoMap = new Map<unknown, unknown>([
      [Citizen, txCitizenRepo],
      [Card, txCardRepo],
      [Transfer, txTransferRepo],
      [Application, txAppRepo],
      [ApplicationCustomField, txCustomFieldRepo],
      [ApplicationStatusHistory, txHistoryRepo],
    ]);

    appRepo.manager.transaction.mockImplementation(
      async (cb: (manager: { getRepository: (e: unknown) => unknown }) => Promise<unknown>) =>
        cb({
          getRepository: (entity: unknown) => repoMap.get(entity),
        }),
    );

    const wb = await templateService.generateTemplateWorkbook();
    const appWs = wb.getWorksheet(SHEET_NAMES.APPLICATIONS)!;

    // 3-qator: Tayyor (yangi) ariza
    const r3 = appWs.getRow(3);
    r3.getCell(findColIdx(appWs, 'link_code')).value = 'A1';
    r3.getCell(findColIdx(appWs, 'application_number')).value = '2026-70001';
    r3.getCell(findColIdx(appWs, 'date')).value = '2026-11-25';
    r3.getCell(findColIdx(appWs, 'district')).value = 'Qarshi sh.';
    r3.getCell(findColIdx(appWs, 'crime')).value = '168-modda';
    r3.getCell(findColIdx(appWs, 'citizen_last_name')).value = 'Rahimov';
    r3.getCell(findColIdx(appWs, 'citizen_first_name')).value = 'Dilshod';
    r3.getCell(findColIdx(appWs, 'citizen_phone')).value = '+998931234567';
    r3.commit();

    // 4-qator: Xatoli ariza (bazada yo'q tuman + qisqa karta)
    const r4 = appWs.getRow(4);
    r4.getCell(findColIdx(appWs, 'link_code')).value = 'A2';
    r4.getCell(findColIdx(appWs, 'application_number')).value = '2026-70002';
    r4.getCell(findColIdx(appWs, 'date')).value = '2026-11-25';
    r4.getCell(findColIdx(appWs, 'district')).value = 'Xato Tuman';
    r4.getCell(findColIdx(appWs, 'crime')).value = '168-modda';
    r4.getCell(findColIdx(appWs, 'citizen_last_name')).value = 'Qodirov';
    r4.getCell(findColIdx(appWs, 'citizen_first_name')).value = 'Alisher';
    r4.getCell(findColIdx(appWs, 'citizen_phone')).value = '+998941234567';
    r4.getCell(findColIdx(appWs, 'victim_card_number')).value = '12345';
    r4.commit();

    const commitRes = await importService.commit(await toBuffer(wb), { skipErrors: true });

    expect(commitRes.createdCount).toBe(1);
    expect(commitRes.failedCount).toBe(1);
    expect(commitRes.createdApplications[0].application_number).toBe('2026-70001');
    expect(intelligenceSync.syncApplicationById).toHaveBeenCalledTimes(1);
    expect(slaQueueService.scheduleForApplication).toHaveBeenCalledTimes(1);
    expect(commitRes.errorReportBase64).toBeTruthy();
    expect(commitRes.errorReportFileName).toMatch(/^Xatoli_qatorlar_\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Qaytgan xatolik Excelini tekshiramiz:
    // 1) Faqat 1 ta yozilmagan qator bor (2026-70002)
    // 2) Aynan district va victim_card_number kataklarida qizil fon (FFFEE2E2) va izoh (note) bor
    // 3) To'g'ri kataklar (citizen_last_name) qizil emas
    // 4) Oxirgi ustun "Xatolik sababi"
    const errWb = new ExcelJS.Workbook();
    await errWb.xlsx.load(
      Buffer.from(commitRes.errorReportBase64!, 'base64') as unknown as ExcelJS.Buffer,
    );
    const errAppWs = errWb.getWorksheet(SHEET_NAMES.APPLICATIONS)!;
    // 2-qator xatoli ariza, 3-qatordan boshlab ma'lumot yo'q (faqat bo'sh dropdown kataklari)
    expect(errAppWs.getCell(1, APP_IMPORT_COLUMNS.length + 1).value).toBe(ERROR_REASON_HEADER);
    expect(errAppWs.getCell(2, findColIdx(errAppWs, 'application_number')).value).toBe(
      '2026-70002',
    );
    expect(errAppWs.getCell(3, findColIdx(errAppWs, 'application_number')).value).toBeNull();

    const badDistrictCell = errAppWs.getCell(2, findColIdx(errAppWs, 'district'));
    expect((badDistrictCell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFEE2E2');
    expect(badDistrictCell.note).toBeTruthy();

    const badCardCell = errAppWs.getCell(2, findColIdx(errAppWs, 'victim_card_number'));
    expect((badCardCell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFEE2E2');
    expect(badCardCell.note).toBeTruthy();

    const goodNameCell = errAppWs.getCell(2, findColIdx(errAppWs, 'citizen_last_name'));
    expect((goodNameCell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb).not.toBe(
      'FFFEE2E2',
    );

    // Endi aynan shu xatolik faylidagi 2 ta qizil katakni to'g'irlab qayta yuklaymiz!
    badDistrictCell.value = 'Qarshi sh.';
    badCardCell.value = '8600999988887777';
    const reuploadPreview = await importService.preview(await toBuffer(errWb));
    expect(reuploadPreview.totalRows).toBe(1);
    expect(reuploadPreview.readyCount).toBe(1);
    expect(reuploadPreview.errorCount).toBe(0);
    // "Xatolik sababi" ustuni ignoredExtraColumns ga ham tushmasdan jimgina e'tiborsiz qoldiriladi
    expect(reuploadPreview.ignoredExtraColumns).toEqual([]);
  });
});
