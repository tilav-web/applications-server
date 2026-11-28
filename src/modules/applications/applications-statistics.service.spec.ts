import type { Repository } from 'typeorm';

import {
  AppealType,
  ApplicationRepeatType,
  SubmissionForm,
} from '../../common/enums/appeal-classification.enum';
import { ApplicationStatus } from '../../common/enums/application-status.enum';
import { Role } from '../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import type { User } from '../users/user.entity';
import type { Application } from './application.entity';
import { ApplicationsStatisticsService } from './applications-statistics.service';
import type { ApplicationDamage } from './damages/application-damage.entity';
import type { District } from './districts/district.entity';
import { ApplicationStatusCategory } from './statuses/application-status.entity';
import type { Transfer } from './transfers/transfer.entity';

interface MockQb {
  leftJoin: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  innerJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  setParameters: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
  getRawOne: jest.Mock;
}

function createMockQb(overrides?: Partial<MockQb>): MockQb {
  const qb: MockQb = {
    leftJoin: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    innerJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameters: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
  for (const key of [
    'leftJoin',
    'leftJoinAndSelect',
    'innerJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'setParameters',
    'orderBy',
    'addOrderBy',
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

describe('ApplicationsStatisticsService', () => {
  let service: ApplicationsStatisticsService;
  let applicationRepo: { createQueryBuilder: jest.Mock };
  let transferRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let damageRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let districtRepo: { find: jest.Mock };
  let userRepo: { findOne: jest.Mock };

  beforeEach(() => {
    applicationRepo = { createQueryBuilder: jest.fn() };
    transferRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() =>
        createMockQb({ getRawOne: jest.fn().mockResolvedValue({ loss: '0' }) }),
      ),
    };
    damageRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() =>
        createMockQb({ getRawOne: jest.fn().mockResolvedValue({ loss: '0' }) }),
      ),
    };
    districtRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { findOne: jest.fn().mockResolvedValue(null) };

    service = new ApplicationsStatisticsService(
      applicationRepo as unknown as Repository<Application>,
      transferRepo as unknown as Repository<Transfer>,
      damageRepo as unknown as Repository<ApplicationDamage>,
      districtRepo as unknown as Repository<District>,
      userRepo as unknown as Repository<User>,
    );
  });

  describe('getSlaOverview', () => {
    it('returns empty zeros immediately without querying applications when DISTRICT_OFFICER has no districts', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });

      const res = await service.getSlaOverview(OFFICER_USER);

      expect(res).toEqual({
        totalActive: 0,
        overdueCount: 0,
        due24hCount: 0,
        due72hCount: 0,
        extendedCount: 0,
        onTrackCount: 0,
        urgentItems: [],
      });
      expect(applicationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('applies district filter to both queries and computes hours_remaining for urgent items', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const now = Date.now();
      const aggQb = createMockQb({
        getRawOne: jest.fn().mockResolvedValue({
          totalActive: '12',
          overdueCount: '2',
          due24hCount: '3',
          due72hCount: '4',
          extendedCount: '1',
          onTrackCount: '3',
        }),
      });
      const urgentQb = createMockQb({
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'app-overdue',
            application_number: '2026-00001',
            deadline_at: new Date(now - 5 * 60 * 60 * 1000),
            sla_days: 10,
            extended_until: null,
            district: { name: 'Qarshi sh.' },
            citizen: { full_name: 'Ali Valiyev' },
            application_status: { name: 'Jarayonda', color: 'amber' },
          },
        ]),
      });
      applicationRepo.createQueryBuilder.mockReturnValueOnce(aggQb).mockReturnValueOnce(urgentQb);

      const res = await service.getSlaOverview(OFFICER_USER);

      expect(aggQb.andWhere).toHaveBeenCalledWith('app.district_id IN (:...userDistricts)', {
        userDistricts: ['dist-1'],
      });
      expect(urgentQb.andWhere).toHaveBeenCalledWith('app.district_id IN (:...userDistricts)', {
        userDistricts: ['dist-1'],
      });
      expect(res.totalActive).toBe(12);
      expect(res.overdueCount).toBe(2);
      expect(res.urgentItems[0].hours_remaining).toBeLessThanOrEqual(-4);
    });
  });

  describe('getStatistics', () => {
    it('excludes DUPLICATE applications from totalLoss, timeline loss, and provider totalAmount while deduplicating transfers and ignoring USD', async () => {
      const today = new Date();
      const apps: Partial<Application>[] = [
        {
          id: 'app-1',
          application_number: '2026-00001',
          status: ApplicationStatus.HAL_QILINDI,
          application_status: {
            code: 'HAL_QILINDI',
            category: ApplicationStatusCategory.CLOSED,
          } as never,
          repeat_type: ApplicationRepeatType.PRIMARY,
          appeal_type: AppealType.APPEAL,
          submission_form: SubmissionForm.ELECTRONIC,
          date: today,
          created_at: today,
          district: { id: 'd1', name: 'Qarshi sh.', region_id: 'r1' } as never,
          crime: { id: 'c1', article: '168-modda', title: 'Firibgarlik' } as never,
          awareness_status: { id: 'aw-1', name: 'Xabardor', is_informed: true } as never,
          transfer: {
            id: 'tr-1',
            amount: 1_000_000,
            currency: 'UZS',
            payment_provider: { name: 'Click' },
          } as never,
        },
        {
          id: 'app-dup',
          application_number: '2026-00002',
          status: ApplicationStatus.YANGI,
          application_status: { code: 'YANGI', category: ApplicationStatusCategory.OPEN } as never,
          repeat_type: ApplicationRepeatType.DUPLICATE,
          appeal_type: AppealType.COMPLAINT,
          submission_form: SubmissionForm.WRITTEN,
          date: today,
          created_at: today,
          district: { id: 'd1', name: 'Qarshi sh.', region_id: 'r1' } as never,
          awareness_status: { id: 'aw-2', name: 'Xabarsiz', is_informed: false } as never,
          transfer: {
            id: 'tr-dup',
            amount: 9_000_000,
            currency: 'UZS',
            payment_provider: { name: 'Click' },
          } as never,
        },
      ];

      const appsQb = createMockQb({ getMany: jest.fn().mockResolvedValue(apps) });
      const prevQb = createMockQb({ getRawOne: jest.fn().mockResolvedValue({ count: '1' }) });
      applicationRepo.createQueryBuilder.mockReturnValueOnce(appsQb).mockReturnValueOnce(prevQb);

      // tr-1 returned again in extraTransfers (must NOT be double-counted!), plus a USD transfer (must be excluded from UZS!)
      transferRepo.find.mockResolvedValue([
        {
          id: 'tr-1',
          application_id: 'app-1',
          amount: 1_000_000,
          currency: 'UZS',
          payment_provider: { name: 'Click' },
        },
        {
          id: 'tr-usd',
          application_id: 'app-1',
          amount: 500,
          currency: 'USD',
          payment_provider: { name: 'Payme' },
        },
      ]);
      // Non-card damage: 500_000 UZS on app-1 + 3_000_000 UZS on app-dup (excluded!)
      damageRepo.find.mockResolvedValue([
        { id: 'dmg-1', application_id: 'app-1', amount: 500_000, currency: 'UZS' },
        { id: 'dmg-dup', application_id: 'app-dup', amount: 3_000_000, currency: 'UZS' },
      ]);
      transferRepo.createQueryBuilder.mockReturnValue(
        createMockQb({ getRawOne: jest.fn().mockResolvedValue({ loss: '500000' }) }),
      );
      damageRepo.createQueryBuilder.mockReturnValue(
        createMockQb({ getRawOne: jest.fn().mockResolvedValue({ loss: '500000' }) }),
      );
      districtRepo.find.mockResolvedValue([
        { id: 'd1', name: 'Qarshi sh.', region: { code: 'QASHQADARYO' } },
        { id: 'd2', name: 'Koson t.', region: { code: 'QASHQADARYO' } },
        { id: 'd-other-region', name: 'Toshkent', region: { code: 'TOSHKENT' } },
      ]);

      const stats = await service.getStatistics('week', undefined, undefined, ADMIN_USER);

      expect(stats.summary.totalApplications).toBe(2);
      expect(stats.summary.resolvedApplications).toBe(1);
      expect(stats.summary.newApplications).toBe(1);
      expect(stats.summary.cardTransfersLoss).toBe(1_000_000);
      expect(stats.summary.nonCardDamagesLoss).toBe(500_000);
      expect(stats.summary.totalLoss).toBe(1_500_000);
      expect(stats.summary.resolvedLoss).toBe(1_500_000);
      expect(stats.summary.comparison.totalPercentChange).toBe(100); // 1 -> 2 = +100%
      expect(stats.summary.comparison.lossPercentChange).toBe(50); // 1_000_000 -> 1_500_000 = +50%

      // Timeline loss MUST match summary.totalLoss (DUPLICATE excluded!)
      const timelineLossSum = stats.timeline.reduce((s, t) => s + t.loss, 0);
      expect(timelineLossSum).toBe(1_500_000);

      // Provider totalAmount MUST exclude DUPLICATE loss (1_000_000, NOT 10_000_000!)
      const clickStats = stats.byPaymentProvider.find((p) => p.name === 'Click');
      expect(clickStats?.totalAmount).toBe(1_000_000);

      // Awareness percentage computed over known statuses (1 informed / 2 known = 50%)
      expect(stats.byAwarenessStatus.informedPercent).toBe(50);

      // Only Qashqadaryo districts prefilled with 0s (Toshkent excluded)
      expect(stats.byDistrict.map((d) => d.id)).toEqual(['d1', 'd2']);
    });

    it('swaps reversed custom startDate/endDate, clamps > 5-year spans, and handles empty results with 0s', async () => {
      const appsQb = createMockQb({ getMany: jest.fn().mockResolvedValue([]) });
      const prevQb = createMockQb({ getRawOne: jest.fn().mockResolvedValue({ count: '0' }) });
      applicationRepo.createQueryBuilder.mockReturnValueOnce(appsQb).mockReturnValueOnce(prevQb);

      const stats = await service.getStatistics('custom', '2026-11-28', '2015-01-01', ADMIN_USER);

      const startMs = new Date(stats.startDate).getTime();
      const endMs = new Date(stats.endDate).getTime();
      expect(startMs).toBeLessThan(endMs);
      // Clamped to <= 5 years + 1 day tolerance
      const spanDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
      expect(spanDays).toBeLessThanOrEqual(5 * 366 + 1);
      expect(stats.summary.totalApplications).toBe(0);
      expect(stats.summary.avgLoss).toBe(0);
      expect(stats.summary.resolutionRate).toBe(0);
      expect(stats.summary.comparison.totalPercentChange).toBe(0);
    });

    it('builds 12 two-hour timeline buckets for period = today and handles string dates in recentApplications', async () => {
      const todayIso = new Date().toISOString();
      const appsQb = createMockQb({
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'app-str-date',
            status: ApplicationStatus.RAD_ETILDI,
            date: todayIso as unknown as Date,
            created_at: todayIso as unknown as Date,
          },
        ]),
      });
      const prevQb = createMockQb({ getRawOne: jest.fn().mockResolvedValue({ count: '0' }) });
      applicationRepo.createQueryBuilder.mockReturnValueOnce(appsQb).mockReturnValueOnce(prevQb);

      const stats = await service.getStatistics('today', undefined, undefined, ADMIN_USER);

      expect(stats.timeline).toHaveLength(12);
      expect(stats.summary.rejectedApplications).toBe(1);
      expect(stats.recentApplications[0].date).toBe(new Date(todayIso).toISOString());
    });
  });
});
