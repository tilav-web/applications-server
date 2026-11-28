import type { Repository } from 'typeorm';

import { Role } from '../../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import type { User } from '../../users/user.entity';
import type { Application } from '../application.entity';
import type { Crime } from '../crimes/crime.entity';
import type { District } from '../districts/district.entity';
import {
  ApplicationsReportsService,
  QASHQADARYO_ORDERED_DISTRICTS,
} from './applications-reports.service';

interface MockQb {
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
}

function createMockQb(overrides?: Partial<MockQb>): MockQb {
  const qb: MockQb = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    ...overrides,
  };
  for (const key of [
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
  ] as const) {
    if (!overrides?.[key]) qb[key].mockReturnValue(qb);
  }
  return qb;
}

const ADMIN_USER: JwtAccessPayload = { sub: 'auth-admin', username: 'admin', role: Role.ADMIN };
const OFFICER_USER: JwtAccessPayload = {
  sub: 'auth-officer',
  username: 'officer',
  role: Role.DISTRICT_OFFICER,
};

describe('ApplicationsReportsService', () => {
  let service: ApplicationsReportsService;
  let applicationRepo: { createQueryBuilder: jest.Mock };
  let districtRepo: { find: jest.Mock };
  let crimeRepo: Record<string, jest.Mock>;
  let userRepo: { findOne: jest.Mock };

  beforeEach(() => {
    applicationRepo = { createQueryBuilder: jest.fn() };
    districtRepo = { find: jest.fn().mockResolvedValue([]) };
    crimeRepo = {};
    userRepo = { findOne: jest.fn().mockResolvedValue(null) };

    service = new ApplicationsReportsService(
      applicationRepo as unknown as Repository<Application>,
      districtRepo as unknown as Repository<District>,
      crimeRepo as unknown as Repository<Crime>,
      userRepo as unknown as Repository<User>,
    );
  });

  describe('getOperationalMatrix', () => {
    it('classifies daily/monthly/yearly crimes, repeats, operational measures, decisions, unknown districts, and totals', async () => {
      const targetDay = new Date('2026-11-28T10:00:00.000Z');
      const earlierInMonth = new Date('2026-11-05T10:00:00.000Z');
      const earlierInYear = new Date('2026-03-15T10:00:00.000Z');

      const apps: Partial<Application>[] = [
        {
          id: 'a1',
          date: targetDay,
          district: { id: 'd-qarshi', name: 'Qarshi sh.' } as never,
          crime: { article: '168-modda Firibgarlik' } as never,
          citizen: { phone_number: '998901112233' } as never,
          suspect_tree: [{ id: 's1' }] as never,
          transfer: { status: 'MUZLATILGAN' } as never,
          officer_notes: "Sanksiya olindi, jinoyat ishi qo'zg'atiladi",
          status: 'JARAYONDA',
        },
        {
          id: 'a2',
          date: earlierInMonth,
          district: { id: 'd-qarshi', name: 'Qarshi sh.' } as never,
          crime: { article: '169-modda O‘g‘rilik' } as never,
          citizen: { phone_number: '998901112233' } as never, // shared phone -> repeated
          status: 'RAD_ETILDI',
          rejection_reason: { name: 'Onlayn kredit bo‘yicha' } as never,
        },
        {
          id: 'a3',
          date: earlierInYear,
          district: null, // must go to "Hududi ko'rsatilmagan", NOT Qarshi sh.!
          crime: { article: 'Haqorat qilish' } as never,
          status: 'HAL_QILINDI',
        },
      ];

      applicationRepo.createQueryBuilder.mockReturnValue(
        createMockQb({ getMany: jest.fn().mockResolvedValue(apps) }),
      );
      districtRepo.find.mockResolvedValue([{ id: 'd-qarshi', name: 'Qarshi sh.' }]);

      const result = await service.getOperationalMatrix({ date: '2026-11-28' }, ADMIN_USER);

      expect(result.rows.length).toBe(QASHQADARYO_ORDERED_DISTRICTS.length + 1);
      const qarshi = result.rows.find((r) => r.district_name === 'Qarshi sh.')!;
      const unknown = result.rows.find((r) => r.district_name === "Hududi ko'rsatilmagan")!;

      expect(qarshi.daily_total).toBe(1);
      expect(qarshi.daily_fraud).toBe(1);
      expect(qarshi.month_total).toBe(2);
      expect(qarshi.m168_year).toBe(1);
      expect(qarshi.m169_year).toBe(1);
      expect(qarshi.total_168_169).toBe(2);
      expect(qarshi.repeated_count).toBe(2);
      expect(qarshi.search_fund).toBe(1);
      expect(qarshi.card_blocked).toBe(1);
      expect(qarshi.sanction_taken).toBe(1);
      expect(qarshi.in_progress_initiate).toBe(1);
      expect(qarshi.rejected_credit).toBe(1);

      expect(unknown.year_total).toBe(1);
      expect(unknown.initiated_total).toBe(1);

      expect(result.total.year_total).toBe(3);
      expect(result.total.month_total).toBe(2);
      expect(result.total.daily_total).toBe(1);
    });

    it('falls back safely on invalid date and fails closed for DISTRICT_OFFICER with empty districts', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });
      const qb = createMockQb({ getMany: jest.fn().mockResolvedValue([]) });
      applicationRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getOperationalMatrix({ date: 'not-a-date' }, OFFICER_USER);

      expect(qb.andWhere).toHaveBeenCalledWith('1 = 0');
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.total.year_total).toBe(0);
    });
  });

  describe('getDepartmentServices', () => {
    it('does NOT misclassify Huquqbuzarliklar profilaktikasi xizmati as spiritual_educational or Qashqadaryo/yonalish as traffic_safety', async () => {
      const targetDay = new Date('2026-11-28T12:00:00.000Z');
      const apps: Partial<Application>[] = [
        {
          id: 'd1',
          date: targetDay,
          district: { id: 'q1', name: 'Qarshi sh.' } as never,
          // Contains "ma" in "xizmati" -> MUST be crime_prevention, NOT spiritual_educational!
          department_service: { name: 'Huquqbuzarliklar profilaktikasi xizmati' } as never,
        },
        {
          id: 'd2',
          date: targetDay,
          district: { id: 'q1', name: 'Qarshi sh.' } as never,
          // Contains "yo" in "Qashqadaryo" -> MUST be cyber_security, NOT traffic_safety!
          department_service: { name: "Qashqadaryo maxsus yo'nalish bo'limi" } as never,
        },
        {
          id: 'd3',
          date: targetDay,
          district: { id: 'q1', name: 'Qarshi sh.' } as never,
          department_service: { name: "Ma'naviy-ma'rifiy ishlar xizmati (MMIX)" } as never,
        },
        {
          id: 'd4',
          date: targetDay,
          district: { id: 'q1', name: 'Qarshi sh.' } as never,
          department_service: { name: "Yo'l harakati xavfsizligi (YHXX)" } as never,
        },
      ];

      const qb = createMockQb({ getMany: jest.fn().mockResolvedValue(apps) });
      applicationRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getDepartmentServices(
        { date: '2026-11-28', startDate: '2026-11-01', endDate: '2026-11-28' },
        ADMIN_USER,
      );

      // endDate must be extended to 23:59:59.999
      const endCall = qb.andWhere.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes(':periodEnd'),
      ) as [string, { periodEnd: Date }];
      expect(endCall[1].periodEnd.getHours()).toBe(23);
      expect(endCall[1].periodEnd.getMinutes()).toBe(59);

      const qarshi = res.rows.find((r) => r.district_name === 'Qarshi sh.')!;
      expect(qarshi.crime_prevention.daily).toBe(1);
      expect(qarshi.cyber_security.daily).toBe(1);
      expect(qarshi.spiritual_educational.daily).toBe(1);
      expect(qarshi.traffic_safety.daily).toBe(1);
      expect(qarshi.total.daily).toBe(4);
      expect(res.total.total.period).toBe(4);
    });
  });

  describe('getRegistryReport', () => {
    it('clamps pagination, escapes LIKE wildcards, deduplicates transfers/cards, and sums UZS-only losses', async () => {
      const qb = createMockQb({
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 'app-1',
              application_number: '2026-00100',
              date: new Date('2026-11-20T00:00:00.000Z'),
              created_at: new Date('2026-11-20T00:00:00.000Z'),
              citizen: { full_name: 'Ali Valiyev', phone_number: '998901234567' },
              district: { name: 'Qarshi sh.' },
              card: { card_number: '8600111122223333', bank: { name: 'Agrobank' } },
              transfer: {
                id: 'tr-1',
                amount: 1_000_000,
                currency: 'UZS',
                sender_card: { card_number: '8600111122223333', bank: { name: 'Agrobank' } },
                payment_provider: { name: 'Click' },
              },
              custom_fields: [
                {
                  card: { card_number: '9860444455556666' },
                  // Duplicate of app.transfer (tr-1) -> must NOT double-count!
                  transfer: { id: 'tr-1', amount: 1_000_000, currency: 'UZS' },
                },
                {
                  // USD transfer -> must NOT be added to UZS sum!
                  transfer: { id: 'tr-2', amount: 200, currency: 'USD' },
                },
              ],
              damages: [
                { amount: 500_000, currency: 'UZS' },
                { amount: 300, currency: 'USD' },
              ],
            },
          ],
          1,
        ]),
      });
      applicationRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.getRegistryReport(
        {
          page: -5,
          limit: 99999,
          search: '100%_test',
          startDate: 'invalid',
          endDate: 'invalid',
        },
        ADMIN_USER,
        500,
      );

      expect(res.page).toBe(1);
      expect(res.limit).toBe(500);
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :s'), {
        s: '%100\\%\\_test%',
      });
      expect(res.items[0].loss_amount).toBe(1_500_000);
      expect(res.items[0].card_numbers).toBe('8600111122223333, 9860444455556666');
      expect(res.items[0].banks).toBe('Agrobank');
    });
  });

  describe('Excel exports', () => {
    it('exportDepartmentServicesExcel includes spiritual_educational column (20 columns A..T) with SUM formulas', async () => {
      applicationRepo.createQueryBuilder.mockReturnValue(
        createMockQb({ getMany: jest.fn().mockResolvedValue([]) }),
      );

      const wb = await service.exportDepartmentServicesExcel({ date: '2026-11-28' }, ADMIN_USER);
      const sheet = wb.getWorksheet('Соҳавий_хизматлар')!;

      expect(sheet.getCell('Q3').value).toBe('Маънавий-маърифий ишлар');
      expect(sheet.getCell('S3').value).toBe('Жами кўрсаткич');
      const totalRow = sheet.getRow(5 + QASHQADARYO_ORDERED_DISTRICTS.length);
      expect(totalRow.getCell(20).value).toEqual({
        formula: `SUM(T5:T${4 + QASHQADARYO_ORDERED_DISTRICTS.length})`,
      });
    });

    it('exportOperationalMatrixExcel sanitizes Excel formula injection in district names', async () => {
      applicationRepo.createQueryBuilder.mockReturnValue(
        createMockQb({
          getMany: jest.fn().mockResolvedValue([
            {
              id: 'a1',
              date: new Date('2026-11-28T10:00:00.000Z'),
              district: { id: 'd-evil', name: '=CMD|calc' },
            },
          ]),
        }),
      );

      const wb = await service.exportOperationalMatrixExcel({ date: '2026-11-28' }, ADMIN_USER);
      const sheet = wb.getWorksheet('Тезкор_кўрсаткичлар')!;
      const injectedRow = sheet.getRow(6 + QASHQADARYO_ORDERED_DISTRICTS.length);
      expect(injectedRow.getCell(2).value).toBe("'=CMD|calc");
    });

    it('exportRegistryExcel adds total SUM formula row when items exist and omits it when empty', async () => {
      applicationRepo.createQueryBuilder.mockReturnValueOnce(
        createMockQb({ getManyAndCount: jest.fn().mockResolvedValue([[], 0]) }),
      );
      const emptyWb = await service.exportRegistryExcel({}, ADMIN_USER);
      const emptySheet = emptyWb.getWorksheet('Мурожаатлар_реестри')!;
      expect(emptySheet.getRow(3).getCell(9).value).toBeNull();

      applicationRepo.createQueryBuilder.mockReturnValueOnce(
        createMockQb({
          getManyAndCount: jest.fn().mockResolvedValue([
            [
              {
                id: 'a1',
                date: new Date('2026-11-28'),
                created_at: new Date('2026-11-28'),
                transfer: { id: 't1', amount: 250000, currency: 'UZS' },
              },
            ],
            1,
          ]),
        }),
      );
      const filledWb = await service.exportRegistryExcel({}, ADMIN_USER);
      const filledSheet = filledWb.getWorksheet('Мурожаатлар_реестри')!;
      expect(filledSheet.getRow(4).getCell(9).value).toBe('ЖАМИ ЗАРАР:');
      expect(filledSheet.getRow(4).getCell(10).value).toEqual({ formula: 'SUM(J3:J3)' });
    });
  });
});
