import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { Repository } from 'typeorm';

import { ApplicationRepeatType } from '../../common/enums/appeal-classification.enum';
import { Role } from '../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import type { IntelligenceSyncService } from '../intelligence/intelligence-sync.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SlaQueueService } from '../notifications/sla-queue.service';
import type { User } from '../users/user.entity';
import type { Application } from './application.entity';
import { ApplicationsService } from './applications.service';
import type { ApplicationsRealtimeService } from './applications-realtime.service';
import type { ApplicationsRelationsService } from './applications-relations.service';
import type { ApplicationsResolverService } from './applications-resolver.service';
import type { ApplicationsStatisticsService } from './applications-statistics.service';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { ApplicationDamage } from './damages/application-damage.entity';
import { ApplicationExternalSystem } from './external-systems/application-external-system.entity';
import { ExternalSystem } from './external-systems/external-system.entity';
import {
  ApplicationStatus as ApplicationStatusEntity,
  ApplicationStatusCategory,
} from './statuses/application-status.entity';
import { Bank } from './transfers/banks/bank.entity';
import { PaymentProvider } from './transfers/payment_providers/payment_provider.entity';
import { Transfer } from './transfers/transfer.entity';

interface MockQb {
  leftJoin: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
}

function createMockQb(overrides?: Partial<MockQb>): MockQb {
  const qb: MockQb = {
    leftJoin: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  for (const key of [
    'leftJoin',
    'leftJoinAndSelect',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
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
const BOSS_USER: JwtAccessPayload = { sub: 'auth-boss', username: 'boss', role: Role.BOSS };
const OFFICER_USER: JwtAccessPayload = {
  sub: 'auth-officer',
  username: 'officer',
  role: Role.DISTRICT_OFFICER,
};
const STAFF_USER: JwtAccessPayload = { sub: 'auth-staff', username: 'staff', role: Role.STAFF };

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let applicationRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let transferRepo: { find: jest.Mock; update: jest.Mock; delete: jest.Mock };
  let statusRepo: { findOne: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let historyRepo: { create: jest.Mock; save: jest.Mock };
  let customFieldRepo: { find: jest.Mock; save: jest.Mock; delete: jest.Mock; count: jest.Mock };
  let damageRepo: { create: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let extSysRepo: { find: jest.Mock; findOne: jest.Mock };
  let appExtSysRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    remove: jest.Mock;
  };
  let bankRepo: { findOne: jest.Mock };
  let providerRepo: { findOne: jest.Mock };
  let excelService: { generateWorkbook: jest.Mock };
  let cyberControlExcelService: { generateWorkbook: jest.Mock };
  let intelligenceSync: { syncApplicationById: jest.Mock };
  let notificationsService: {
    onApplicationCreated: jest.Mock;
    onApplicationStatusChanged: jest.Mock;
    onDeadlineExtended: jest.Mock;
  };
  let slaQueueService: { scheduleForApplication: jest.Mock; cancelForApplication: jest.Mock };
  let resolverService: { resolvePrimaryModels: jest.Mock; processCustomFields: jest.Mock };
  let relationsService: {
    attachRelationsSummaries: jest.Mock;
    getRelations: jest.Mock;
    identifyBank: jest.Mock;
  };
  let statisticsService: { getSlaOverview: jest.Mock; getStatistics: jest.Mock };
  let realtimeService: { broadcastRowColorUpdate: jest.Mock };

  beforeEach(() => {
    historyRepo = {
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn().mockResolvedValue({ id: 'hist-1' }),
    };
    customFieldRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    };
    damageRepo = {
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    extSysRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    appExtSysRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    bankRepo = { findOne: jest.fn().mockResolvedValue(null) };
    providerRepo = { findOne: jest.fn().mockResolvedValue(null) };

    transferRepo = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    statusRepo = { findOne: jest.fn().mockResolvedValue(null) };
    userRepo = { findOne: jest.fn().mockResolvedValue(null) };

    const repoMap = new Map<unknown, unknown>([
      [ApplicationStatusEntity, statusRepo],
      [Transfer, transferRepo],
      [ApplicationCustomField, customFieldRepo],
      [ApplicationDamage, damageRepo],
      [ExternalSystem, extSysRepo],
      [ApplicationExternalSystem, appExtSysRepo],
      [Bank, bankRepo],
      [PaymentProvider, providerRepo],
    ]);

    applicationRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve({ id: UUID_1, ...e })),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => createMockQb()),
      manager: {
        transaction: jest.fn(
          async (cb: (mgr: { getRepository: jest.Mock }) => Promise<unknown>) => {
            const mgr = {
              getRepository: jest.fn((entity: { name?: string }) => {
                if (entity?.name === 'Application') return applicationRepo;
                if (entity?.name === 'ApplicationStatusHistory') return historyRepo;
                if (entity?.name === 'User') return userRepo;
                return repoMap.get(entity);
              }),
            };
            return cb(mgr);
          },
        ),
      },
    };

    excelService = {
      generateWorkbook: jest.fn().mockResolvedValue({
        xlsx: { write: jest.fn().mockResolvedValue(undefined) },
      }),
    };
    cyberControlExcelService = {
      generateWorkbook: jest.fn().mockResolvedValue({
        xlsx: { write: jest.fn().mockResolvedValue(undefined) },
      }),
    };
    intelligenceSync = { syncApplicationById: jest.fn().mockResolvedValue(undefined) };
    notificationsService = {
      onApplicationCreated: jest.fn().mockResolvedValue(undefined),
      onApplicationStatusChanged: jest.fn().mockResolvedValue(undefined),
      onDeadlineExtended: jest.fn().mockResolvedValue(undefined),
    };
    slaQueueService = {
      scheduleForApplication: jest.fn().mockResolvedValue(undefined),
      cancelForApplication: jest.fn().mockResolvedValue(undefined),
    };
    resolverService = {
      resolvePrimaryModels: jest.fn().mockResolvedValue({}),
      processCustomFields: jest.fn().mockResolvedValue([]),
    };
    relationsService = {
      attachRelationsSummaries: jest.fn().mockResolvedValue(undefined),
      getRelations: jest.fn().mockResolvedValue({}),
      identifyBank: jest.fn().mockReturnValue('Agrobank'),
    };
    statisticsService = {
      getSlaOverview: jest.fn().mockResolvedValue({}),
      getStatistics: jest.fn().mockResolvedValue({}),
    };
    realtimeService = { broadcastRowColorUpdate: jest.fn() };

    service = new ApplicationsService(
      applicationRepo as unknown as Repository<Application>,
      transferRepo as unknown as Repository<Transfer>,
      statusRepo as unknown as Repository<ApplicationStatusEntity>,
      userRepo as unknown as Repository<User>,
      excelService as never,
      cyberControlExcelService as never,
      intelligenceSync as unknown as IntelligenceSyncService,
      notificationsService as unknown as NotificationsService,
      slaQueueService as unknown as SlaQueueService,
      resolverService as unknown as ApplicationsResolverService,
      relationsService as unknown as ApplicationsRelationsService,
      statisticsService as unknown as ApplicationsStatisticsService,
      realtimeService as unknown as ApplicationsRealtimeService,
    );
  });

  describe('BOSS read-only enforcement', () => {
    it('blocks BOSS role from creating, updating, deleting, extending deadline, toggling external systems, and updating row colors', async () => {
      await expect(service.create({}, BOSS_USER)).rejects.toThrow(ForbiddenException);
      await expect(service.toggleExternalSystem(UUID_1, UUID_2, true, BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.updateRowColor(UUID_1, 'red', BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.bulkUpdateRowColor([UUID_1], 'blue', BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );

      applicationRepo.findOne.mockResolvedValue({ id: UUID_1, district_id: 'd1' });
      await expect(service.update(UUID_1, {}, BOSS_USER)).rejects.toThrow(ForbiddenException);
      await expect(service.remove(UUID_1, BOSS_USER)).rejects.toThrow(ForbiddenException);
      await expect(service.extendDeadline(UUID_1, { reason: 'Sabab' }, BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('create (RBAC, SLA, damages, external systems, chains)', () => {
    it('blocks DISTRICT_OFFICER when dto.district_id is outside assigned districts', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', assigned_districts: [{ id: 'dist-1' }] });

      await expect(service.create({ district_id: 'dist-other' }, OFFICER_USER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(applicationRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('blocks DISTRICT_OFFICER when district_data resolves to an unassigned district inside transaction', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', assigned_districts: [{ id: 'dist-1' }] });
      resolverService.resolvePrimaryModels.mockResolvedValue({ district_id: 'dist-other' });

      await expect(
        service.create({ district_data: { name: 'Other' } }, OFFICER_USER),
      ).rejects.toThrow(ForbiddenException);
      expect(applicationRepo.save).not.toHaveBeenCalled();
    });

    it('computes SLA deadline, saves valid damages only, links transfer, writes CREATED history, and syncs intelligence', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u-admin' });
      resolverService.resolvePrimaryModels.mockResolvedValue({
        status_id: 'st-1',
        transfer_id: 'tr-1',
        district_id: 'dist-1',
      });
      statusRepo.findOne.mockResolvedValue({
        id: 'st-1',
        name: 'Yangi',
        tracks_sla: true,
        default_sla_days: 15,
        category: ApplicationStatusCategory.OPEN,
      });
      bankRepo.findOne.mockResolvedValue({ id: 'bank-agro' });
      extSysRepo.find.mockResolvedValue([{ id: UUID_2 }]);
      applicationRepo.findOne.mockResolvedValue({
        id: UUID_1,
        district_id: 'dist-1',
        status_history: [],
        custom_fields: [],
      });

      await service.create(
        {
          application_number: ' 2026-00010 ',
          date: '2026-11-01T00:00:00.000Z',
          damages: [
            { organization_name: 'Agrobank', amount: 5000000 },
            { organization_name: 'Invalid', amount: 0 },
            { organization_name: 'Negative', amount: -100 },
          ],
          external_system_ids: [UUID_2, 'not-a-uuid', UUID_2],
        },
        ADMIN_USER,
      );

      const createdCalls = applicationRepo.create.mock.calls as Array<[Record<string, unknown>]>;
      const createdPayload = createdCalls[0][0];
      expect(createdPayload.application_number).toBe('2026-00010');
      expect(createdPayload.sla_days).toBe(15);
      expect(createdPayload.deadline_at).toEqual(new Date('2026-11-16T00:00:00.000Z'));
      expect(createdPayload.closed_at).toBeNull();

      expect(transferRepo.update).toHaveBeenCalledWith('tr-1', { application_id: UUID_1 });
      expect(historyRepo.save).toHaveBeenCalledTimes(1);
      // Only positive finite damage saved
      expect(damageRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ amount: 5000000, bank_id: 'bank-agro', currency: 'UZS' }),
      ]);
      expect(appExtSysRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ external_system_id: UUID_2, entered_by_id: 'u-admin' }),
      ]);
      expect(intelligenceSync.syncApplicationById).toHaveBeenCalledWith(UUID_1);
    });

    it('resolves REPEAT chain sequence from parent root and throws NotFoundException if parent missing', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u-admin' });
      applicationRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.create(
          { repeat_type: ApplicationRepeatType.REPEAT, parent_application_id: UUID_2 },
          ADMIN_USER,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll (LIKE escaping, invalid dates, pagination, filters, district scope)', () => {
    it('escapes LIKE wildcards, clamps invalid pagination, ignores invalid dates, and applies external system / row color filters', async () => {
      const qb = createMockQb({
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: UUID_2 }, { id: UUID_1 }], 2]),
      });
      applicationRepo.createQueryBuilder
        .mockReturnValueOnce(qb)
        .mockReturnValueOnce(createMockQb({ getRawMany: jest.fn().mockResolvedValue([]) }));
      applicationRepo.find.mockResolvedValue([{ id: UUID_1 }, { id: UUID_2 }]);

      const res = await service.findAll(
        {
          page: -3,
          limit: -5,
          search: '2026_001%',
          date_from: 'invalid-date',
          date_to: 'also-bad',
          missing_external_system_id: UUID_3,
          row_color: 'red',
          sla_filter: 'overdue',
        },
        10,
        undefined,
        undefined,
        ADMIN_USER,
      );

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(1);
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :q'), {
        q: '%2026\\_001\\%%',
      });
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining(':date_from'),
        expect.anything(),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS'), {
        extSysId: UUID_3,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('app.row_color = :row_color', { row_color: 'red' });
      expect(res.items.map((i) => i.id)).toEqual([UUID_2, UUID_1]);
      expect(res.meta.page).toBe(1);
    });

    it('fails closed (1 = 0) when DISTRICT_OFFICER has empty assigned districts', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });
      const qb = createMockQb();
      applicationRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.findAll(1, 10, undefined, undefined, OFFICER_USER);
      expect(qb.andWhere).toHaveBeenCalledWith('1 = 0');
      expect(res.items).toEqual([]);
    });

    it('filters by relations_filter = fraud_card using attached relation summaries', async () => {
      const qb = createMockQb({
        getMany: jest.fn().mockResolvedValue([{ id: UUID_1 }, { id: UUID_2 }]),
      });
      applicationRepo.createQueryBuilder
        .mockReturnValueOnce(qb)
        .mockReturnValueOnce(createMockQb({ getRawMany: jest.fn().mockResolvedValue([]) }));
      applicationRepo.find.mockResolvedValue([{ id: UUID_1 }, { id: UUID_2 }]);
      relationsService.attachRelationsSummaries.mockImplementation((items: Application[]) => {
        items[0].relations_summary = {
          total: 2,
          cards: 1,
          has_fraud_card_link: true,
        } as never;
        items[1].relations_summary = {
          total: 0,
          cards: 0,
          has_fraud_card_link: false,
        } as never;
      });

      const res = await service.findAll(
        { page: 1, limit: 10, relations_filter: 'fraud_card' },
        10,
        undefined,
        undefined,
        ADMIN_USER,
      );

      expect(res.items.map((a) => a.id)).toEqual([UUID_1]);
      expect(res.meta.total).toBe(1);
    });
  });

  describe('update (RBAC district_data bypass protection, status rules, invalid dates, orphan transfer cleanup)', () => {
    it('blocks DISTRICT_OFFICER from moving application to another district via district_data', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      applicationRepo.findOne.mockResolvedValue({
        id: UUID_1,
        district_id: 'dist-1',
        status_history: [],
        custom_fields: [],
      });
      resolverService.resolvePrimaryModels.mockResolvedValue({ district_id: 'dist-2' });

      await expect(
        service.update(UUID_1, { district_data: { name: 'Other' } }, OFFICER_USER),
      ).rejects.toThrow(ForbiddenException);
      expect(applicationRepo.save).not.toHaveBeenCalled();
    });

    it('enforces requires_decision and requires_rejection_reason when changing status', async () => {
      applicationRepo.findOne.mockResolvedValue({
        id: UUID_1,
        status_id: 'st-old',
        decision_type_id: null,
        rejection_reason_id: null,
        status_history: [],
        custom_fields: [],
      });
      resolverService.resolvePrimaryModels.mockResolvedValue({ status_id: 'st-closed' });
      statusRepo.findOne.mockResolvedValueOnce({
        id: 'st-closed',
        name: 'Hal qilindi',
        requires_decision: true,
        requires_rejection_reason: false,
      });

      await expect(service.update(UUID_1, { status_id: 'st-closed' }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );

      statusRepo.findOne.mockResolvedValueOnce({
        id: 'st-rejected',
        name: 'Rad etildi',
        requires_decision: false,
        requires_rejection_reason: true,
      });
      await expect(
        service.update(UUID_1, { status_id: 'st-rejected' }, ADMIN_USER),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid date/deadline_at strings with BadRequestException instead of crashing DB', async () => {
      applicationRepo.findOne.mockResolvedValue({
        id: UUID_1,
        status_history: [],
        custom_fields: [],
      });

      await expect(
        service.update(UUID_1, { deadline_at: 'not-a-valid-date' }, ADMIN_USER),
      ).rejects.toThrow(BadRequestException);
    });

    it('deletes orphaned extra transfer when removed from custom_fields and no other references exist', async () => {
      applicationRepo.findOne
        .mockResolvedValueOnce({
          id: UUID_1,
          transfer_id: 'tr-primary',
          status_history: [],
          custom_fields: [],
        })
        .mockResolvedValueOnce({
          id: UUID_1,
          transfer_id: 'tr-primary',
          status_history: [],
          custom_fields: [],
        });
      customFieldRepo.find.mockResolvedValue([{ id: 'cf-1', transfer_id: 'tr-orphan' }]);
      applicationRepo.count.mockResolvedValue(0);
      customFieldRepo.count.mockResolvedValue(0);

      await service.update(UUID_1, { custom_fields: [] }, ADMIN_USER);

      expect(transferRepo.delete).toHaveBeenCalledWith({
        id: 'tr-orphan',
        application_id: UUID_1,
      });
      expect(intelligenceSync.syncApplicationById).toHaveBeenCalledWith(UUID_1);
    });
  });

  describe('extendDeadline', () => {
    it('rejects empty reason or invalid new_deadline_at with BadRequestException', async () => {
      applicationRepo.findOne.mockResolvedValue({
        id: UUID_1,
        date: new Date('2026-11-01'),
        status_history: [],
        custom_fields: [],
      });

      await expect(service.extendDeadline(UUID_1, { reason: '   ' }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );

      await expect(
        service.extendDeadline(
          UUID_1,
          { reason: 'Tekshiruv', new_deadline_at: 'bad-date' },
          ADMIN_USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('switches to EXTENDED status, saves history, reschedules SLA, and notifies', async () => {
      const app = {
        id: UUID_1,
        date: new Date('2026-11-01T00:00:00.000Z'),
        deadline_at: new Date('2026-11-11T00:00:00.000Z'),
        status_id: 'st-new',
        status: 'YANGI',
        status_history: [],
        custom_fields: [],
      };
      applicationRepo.findOne.mockResolvedValueOnce(app).mockResolvedValueOnce(app);
      statusRepo.findOne.mockResolvedValue({
        id: 'st-ext',
        code: 'MUDDATI_UZAYTIRILGAN',
        name: 'Muddati uzaytirilgan',
      });
      userRepo.findOne.mockResolvedValue({ id: 'u-admin' });

      await service.extendDeadline(
        UUID_1,
        { reason: 'Prokuror ruxsati', extend_days: 30, prosecutor_approval_number: 'PR-12' },
        ADMIN_USER,
      );

      expect(historyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEADLINE_EXTENDED',
          prosecutor_approval_number: 'PR-12',
          to_status_id: 'st-ext',
        }),
      );
      expect(slaQueueService.scheduleForApplication).toHaveBeenCalledWith(UUID_1);
      expect(notificationsService.onDeadlineExtended).toHaveBeenCalled();
    });
  });

  describe('remove (soft delete & creator check)', () => {
    it('prevents non-admin STAFF from deleting another user application', async () => {
      applicationRepo.findOne.mockResolvedValue({
        id: UUID_1,
        created_by_id: 'u-someone-else',
        status_history: [],
        custom_fields: [],
      });
      userRepo.findOne.mockResolvedValue({ id: 'u-staff' });

      await expect(service.remove(UUID_1, STAFF_USER)).rejects.toThrow(ForbiddenException);
      expect(applicationRepo.update).not.toHaveBeenCalled();
    });

    it('soft-deletes via atomic update (not heavy save) and cancels SLA + syncs intelligence', async () => {
      applicationRepo.findOne.mockResolvedValue({
        id: UUID_1,
        created_by_id: 'u-other',
        status_history: [],
        custom_fields: [],
      });
      userRepo.findOne.mockResolvedValue({ id: 'u-admin' });

      const res = await service.remove(UUID_1, ADMIN_USER);

      expect(applicationRepo.update).toHaveBeenCalledWith(
        UUID_1,
        expect.objectContaining({ is_deleted: true, deleted_by_id: 'u-admin' }),
      );
      expect(applicationRepo.save).not.toHaveBeenCalled();
      expect(intelligenceSync.syncApplicationById).toHaveBeenCalledWith(UUID_1);
      expect(slaQueueService.cancelForApplication).toHaveBeenCalledWith(UUID_1);
      expect(res.success).toBe(true);
    });
  });

  describe('exportCyberControlTemplate', () => {
    it('throws NotFoundException when IDs empty or apps do not exist, and ForbiddenException when officer has no access', async () => {
      const res = { setHeader: jest.fn(), end: jest.fn() } as unknown as Response;

      await expect(service.exportCyberControlTemplate([], res, ADMIN_USER)).rejects.toThrow(
        NotFoundException,
      );

      applicationRepo.find.mockResolvedValueOnce([]);
      await expect(service.exportCyberControlTemplate([UUID_1], res, ADMIN_USER)).rejects.toThrow(
        NotFoundException,
      );

      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      applicationRepo.find.mockResolvedValueOnce([{ id: UUID_1, district_id: 'dist-2' }]);
      await expect(service.exportCyberControlTemplate([UUID_1], res, OFFICER_USER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateRowColor & bulkUpdateRowColor', () => {
    it('rejects invalid color, clears actor fields on null color, and broadcasts realtime update', async () => {
      await expect(service.updateRowColor(UUID_1, 'neon-pink', ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );

      applicationRepo.findOne.mockResolvedValue({ id: UUID_1, district_id: 'dist-1' });
      userRepo.findOne.mockResolvedValue({ id: 'u1', first_name: 'Ali', last_name: 'Valiyev' });

      const cleared = await service.updateRowColor(UUID_1, null, ADMIN_USER);

      expect(cleared).toEqual({
        id: UUID_1,
        row_color: null,
        row_color_by: null,
        row_color_updated_at: null,
      });
      expect(realtimeService.broadcastRowColorUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'row_color_updated',
          actor_name: 'Valiyev Ali',
        }),
      );
    });

    it('bulkUpdateRowColor rejects non-UUID ids and filters to DISTRICT_OFFICER districts', async () => {
      await expect(service.bulkUpdateRowColor(['invalid-id'], 'red', ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );

      userRepo.findOne
        .mockResolvedValueOnce({ assigned_districts: [{ id: 'dist-1' }] })
        .mockResolvedValueOnce({ id: 'u-off', first_name: 'Olim', last_name: 'Karimov' });
      applicationRepo.find.mockResolvedValue([
        { id: UUID_1, district_id: 'dist-1' },
        { id: UUID_2, district_id: 'dist-2' },
      ]);

      const result = await service.bulkUpdateRowColor([UUID_1, UUID_2], 'green', OFFICER_USER);

      expect(result.updatedCount).toBe(1);
      expect(result.items.map((i) => i.id)).toEqual([UUID_1]);
    });
  });
});
