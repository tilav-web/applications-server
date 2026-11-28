import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import type { Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import type { Citizen } from '../applications/citizens/citizen.entity';
import type { District } from '../applications/districts/district.entity';
import type { ApplicationStatus } from '../applications/statuses/application-status.entity';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SlaQueueService } from '../notifications/sla-queue.service';
import type { User } from '../users/user.entity';
import { DetectedCrimesService } from './detected-crimes.service';
import { DetectedCrime, DetectedCrimeQualification } from './entities/detected-crime.entity';
import { DetectedCrimeEvidence } from './entities/detected-crime-evidence.entity';
import type { DetectedCrimeStatus } from './entities/detected-crime-status.entity';
import { DetectedCrimeSuspect } from './entities/detected-crime-suspect.entity';

interface MockQb {
  leftJoin: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  innerJoinAndSelect: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  setParameters: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawOne: jest.Mock;
}

function createMockQb(overrides?: Partial<MockQb>): MockQb {
  const qb: MockQb = {
    leftJoin: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    innerJoinAndSelect: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameters: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getRawOne: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
  for (const key of [
    'leftJoin',
    'leftJoinAndSelect',
    'innerJoinAndSelect',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'setParameters',
    'orderBy',
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

describe('DetectedCrimesService', () => {
  let service: DetectedCrimesService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock; query: jest.Mock };
  };
  let suspectRepo: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: unknown;
  };
  let evidenceRepo: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    manager: unknown;
  };
  let statusRepo: { findOne: jest.Mock };
  let crimeStatusRepo: { findOne: jest.Mock };
  let districtRepo: { find: jest.Mock };
  let citizenRepo: Record<string, jest.Mock>;
  let userRepo: { findOne: jest.Mock };
  let slaQueueService: {
    scheduleForDetectedCrime: jest.Mock;
    cancelForDetectedCrime: jest.Mock;
  };
  let notificationsService: { onDetectedCrimeDeadlineExtended: jest.Mock };

  beforeEach(() => {
    suspectRepo = {
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => createMockQb()),
      manager: {},
    };
    evidenceRepo = {
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      manager: {},
    };
    statusRepo = { findOne: jest.fn().mockResolvedValue(null) };
    crimeStatusRepo = { findOne: jest.fn().mockResolvedValue(null) };
    districtRepo = { find: jest.fn().mockResolvedValue([]) };
    citizenRepo = {};
    userRepo = { findOne: jest.fn().mockResolvedValue(null) };
    slaQueueService = {
      scheduleForDetectedCrime: jest.fn().mockResolvedValue(undefined),
      cancelForDetectedCrime: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      onDetectedCrimeDeadlineExtended: jest.fn().mockResolvedValue(undefined),
    };

    const txQuery = jest.fn().mockResolvedValue([{ max_seq: 4 }]);
    repo = {
      findOne: jest.fn(),
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve({ id: 'dc-1', ...e })),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => createMockQb()),
      manager: {
        query: txQuery,
        transaction: jest.fn(async (cb: (mgr: Record<string, unknown>) => Promise<unknown>) => {
          const mgr = {
            query: txQuery,
            getRepository: jest.fn((entity: unknown) => {
              if (entity === DetectedCrime) return repo;
              if (entity === DetectedCrimeSuspect) return suspectRepo;
              if (entity === DetectedCrimeEvidence) return evidenceRepo;
              return repo;
            }),
          };
          return cb(mgr);
        }),
      },
    };

    service = new DetectedCrimesService(
      repo as unknown as Repository<DetectedCrime>,
      suspectRepo as unknown as Repository<DetectedCrimeSuspect>,
      evidenceRepo as unknown as Repository<DetectedCrimeEvidence>,
      statusRepo as unknown as Repository<ApplicationStatus>,
      crimeStatusRepo as unknown as Repository<DetectedCrimeStatus>,
      districtRepo as unknown as Repository<District>,
      citizenRepo as unknown as Repository<Citizen>,
      userRepo as unknown as Repository<User>,
      slaQueueService as unknown as SlaQueueService,
      notificationsService as unknown as NotificationsService,
    );
  });

  describe('BOSS read-only enforcement & RBAC', () => {
    it('blocks BOSS role from create, update, extendDeadline, and remove', async () => {
      await expect(service.create({ title: 'Test' }, BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );

      repo.findOne.mockResolvedValue({ id: 'dc-1', district_id: 'd1' });
      await expect(service.update('dc-1', { title: 'New' }, BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.extendDeadline('dc-1', { reason: 'Sabab' }, BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.remove('dc-1', BOSS_USER)).rejects.toThrow(ForbiddenException);
    });

    it('blocks DISTRICT_OFFICER from creating, viewing, or transferring records outside assigned districts', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', assigned_districts: [{ id: 'dist-1' }] });

      await expect(
        service.create({ title: 'Jinoyat', district_id: 'dist-other' }, OFFICER_USER),
      ).rejects.toThrow(ForbiddenException);

      repo.findOne.mockResolvedValue({ id: 'dc-other', district_id: 'dist-other' });
      await expect(service.findOne('dc-other', OFFICER_USER)).rejects.toThrow(ForbiddenException);

      repo.findOne.mockResolvedValue({ id: 'dc-own', district_id: 'dist-1' });
      await expect(
        service.update('dc-own', { district_id: 'dist-other' }, OFFICER_USER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create (validation, advisory-lock case_number, suspect dedup & repeat skip)', () => {
    it('rejects empty title, invalid dates, and negative estimated_damage with BadRequestException', async () => {
      await expect(service.create({ title: '   ' }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.create({ title: 'Test', detected_at: 'not-a-date' }, ADMIN_USER),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ title: 'Test', estimated_damage: -1000 }, ADMIN_USER),
      ).rejects.toThrow(BadRequestException);
    });

    it('generates sequential AJ-YYYY-0005 case_number, deduplicates suspects, skips repeat query when explicit, and skips blank evidences', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u-admin' });
      crimeStatusRepo.findOne.mockResolvedValue({ id: 'cst-final', is_final: true });
      repo.findOne.mockResolvedValue({ id: 'dc-1', title: 'Kiber fosh' });
      const repeatQb = createMockQb({
        getMany: jest.fn().mockResolvedValue([{ id: 'prior-1', detected_crime: { id: 'dc-old' } }]),
      });
      suspectRepo.createQueryBuilder.mockReturnValue(repeatQb);

      await service.create(
        {
          title: '  Kiber fosh  ',
          estimated_damage: 1_500_000,
          suspects: [
            { citizen_id: 'cit-1', is_repeat_offender: false }, // explicit -> must NOT query DB!
            { citizen_id: 'cit-1', is_repeat_offender: true }, // duplicate -> ignored!
            { citizen_id: 'cit-2' }, // undefined -> queries DB -> detects repeat = true
          ],
          evidences: [
            { title: '   ' }, // blank -> skipped
            { title: 'iPhone 15', identifier_value: '356938035643809' },
          ],
        },
        ADMIN_USER,
      );

      const year = new Date().getFullYear();
      const createCalls = repo.create.mock.calls as Array<[Record<string, unknown>]>;
      expect(createCalls[0][0].case_number).toBe(`AJ-${year}-0005`);
      expect(createCalls[0][0].closed_at).toBeInstanceOf(Date);
      // checkCitizenRepeatHistory called ONLY ONCE (for cit-2, NOT for cit-1)
      expect(suspectRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(suspectRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ citizen_id: 'cit-1', is_repeat_offender: false }),
        expect.objectContaining({ citizen_id: 'cit-2', is_repeat_offender: true }),
      ]);
      expect(evidenceRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'iPhone 15', identifier_value: '356938035643809' }),
      ]);
      expect(slaQueueService.scheduleForDetectedCrime).toHaveBeenCalledWith('dc-1');
    });

    it('converts duplicate manual case_number (23505) into ConflictException', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });

      await expect(
        service.create({ title: 'Test', case_number: 'AJ-2026-0001' }, ADMIN_USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll & repeat/citizen lookups', () => {
    it('escapes LIKE wildcards in search, caps limit at 100, and fails closed for officer without districts', async () => {
      const qb = createMockQb({ getManyAndCount: jest.fn().mockResolvedValue([[], 0]) });
      repo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.findAll(
        { page: -2, limit: 500, search: 'AJ_2026%', status_id: 'st-1' },
        ADMIN_USER,
      );

      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :q'), {
        q: '%AJ\\_2026\\%%',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('dc.crime_status_id = :cstId', { cstId: 'st-1' });
      expect(res.meta.page).toBe(1);
      expect(res.meta.limit).toBe(100);

      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });
      const officerQb = createMockQb();
      repo.createQueryBuilder.mockReturnValue(officerQb);
      await service.findAll({}, OFFICER_USER);
      expect(officerQb.andWhere).toHaveBeenCalledWith('1 = 0');
    });

    it('returns empty repeat history / citizen crimes immediately when DISTRICT_OFFICER has empty districts', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });

      expect(await service.checkCitizenRepeatHistory('cit-1', undefined, OFFICER_USER)).toEqual({
        isRepeat: false,
        count: 0,
        items: [],
      });
      expect(await service.findByCitizenId('cit-1', OFFICER_USER)).toEqual([]);
      expect(suspectRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('update, extendDeadline & remove', () => {
    it('rejects blank title, invalid report_date, negative damage, and duplicate case_number on update', async () => {
      repo.findOne.mockResolvedValue({ id: 'dc-1', title: 'Old' });

      await expect(service.update('dc-1', { title: '   ' }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('dc-1', { report_date: 'bad-date' }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('dc-1', { estimated_damage: -1 }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );

      repo.save.mockRejectedValueOnce({ code: '23505' });
      await expect(service.update('dc-1', { case_number: 'AJ-DUP' }, ADMIN_USER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('clears stale relations, sets closed_at and cancels SLA when transitioning to final status', async () => {
      const existing = {
        id: 'dc-1',
        title: 'Old',
        district: { id: 'd1' },
        suspects: [],
        evidences: [],
        deadline_at: new Date('2026-12-01'),
        closed_at: null,
      };
      repo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
      crimeStatusRepo.findOne.mockResolvedValue({ id: 'cst-done', is_final: true });
      repo.save.mockImplementation((entity: Record<string, unknown>) => {
        expect(entity.district).toBeUndefined();
        expect(entity.suspects).toBeUndefined();
        expect(entity.closed_at).toBeInstanceOf(Date);
        return Promise.resolve(entity);
      });

      await service.update('dc-1', { crime_status_id: 'cst-done' }, ADMIN_USER);
      expect(slaQueueService.cancelForDetectedCrime).toHaveBeenCalledWith(
        'dc-1',
        new Date('2026-12-01').getTime(),
      );
    });

    it('extendDeadline rejects empty reason and reschedules SLA + sends notification on valid request', async () => {
      const item = { id: 'dc-1', detected_at: new Date('2026-11-01') };
      repo.findOne.mockResolvedValue(item);

      await expect(service.extendDeadline('dc-1', { reason: '   ' }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );

      statusRepo.findOne.mockResolvedValue({ id: 'st-ext' });
      await service.extendDeadline(
        'dc-1',
        { reason: 'Ekspertiza', extend_days: 500, prosecutor_approval_number: 'P-9' },
        ADMIN_USER,
      );

      expect(repo.update).toHaveBeenCalledWith(
        'dc-1',
        expect.objectContaining({
          sla_days: 365, // clamped at 365 max
          extension_reason: 'Ekspertiza',
          prosecutor_approval_number: 'P-9',
          status_id: 'st-ext',
        }),
      );
      expect(slaQueueService.scheduleForDetectedCrime).toHaveBeenCalledWith('dc-1');
      expect(notificationsService.onDetectedCrimeDeadlineExtended).toHaveBeenCalled();
    });

    it('remove soft-deletes via atomic update and cancels SLA', async () => {
      repo.findOne.mockResolvedValue({ id: 'dc-1', deadline_at: null });
      userRepo.findOne.mockResolvedValue({ id: 'u-admin' });

      const res = await service.remove('dc-1', ADMIN_USER);
      expect(repo.update).toHaveBeenCalledWith(
        'dc-1',
        expect.objectContaining({ is_deleted: true, deleted_by_id: 'u-admin' }),
      );
      expect(slaQueueService.cancelForDetectedCrime).toHaveBeenCalledWith('dc-1', undefined);
      expect(res.success).toBe(true);
    });

    it('findOne throws NotFoundException when record is missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing', ADMIN_USER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats, getMapStats & exportExcel', () => {
    it('getStats returns instant zeros for officer without districts and clamps inProgressCount >= 0', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });
      const zeroStats = await service.getStats(OFFICER_USER);
      expect(zeroStats.total).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();

      repo.createQueryBuilder.mockReturnValue(
        createMockQb({
          getRawOne: jest.fn().mockResolvedValue({
            total: '10',
            criminalCount: '6',
            adminCount: '3',
            preInvCount: '1',
            finalCount: '4',
            overdueCount: '2',
          }),
        }),
      );
      const stats = await service.getStats(ADMIN_USER);
      expect(stats).toEqual({
        total: 10,
        criminalCount: 6,
        adminCount: 3,
        preInvCount: 1,
        finalCount: 4,
        inProgressCount: 6,
        overdueCount: 2,
      });
    });

    it('getMapStats swaps reversed custom dates, ignores invalid dates, and deduplicates suspect neighborhoods per crime', async () => {
      const qb = createMockQb({
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'dc-1',
            district_id: 'd1',
            estimated_damage: 1_000_000,
            suspects: [
              // Two suspects in the SAME neighborhood must count the crime ONCE!
              { citizen: { neighborhood: { id: 'nb-1', name: 'Navro‘z', district_id: 'd1' } } },
              { citizen: { neighborhood: { id: 'nb-1', name: 'Navro‘z', district_id: 'd1' } } },
            ],
          },
        ]),
      });
      repo.createQueryBuilder.mockReturnValue(qb);
      districtRepo.find.mockResolvedValue([
        { id: 'd1', name: 'Qarshi sh.', region: { code: 'QASHQADARYO' } },
        { id: 'd-tosh', name: 'Toshkent', region: { code: 'TOSHKENT' } },
      ]);

      const res = await service.getMapStats(
        { period: 'custom', startDate: '2026-11-28', endDate: '2026-11-01' },
        ADMIN_USER,
      );

      const fromCall = qb.andWhere.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes(':fromDate'),
      ) as [string, { fromDate: Date }];
      const toCall = qb.andWhere.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes(':toDate'),
      ) as [string, { toDate: Date }];
      expect(fromCall[1].fromDate.getTime()).toBeLessThan(toCall[1].toDate.getTime());

      expect(res.total).toBe(1);
      expect(res.totalDamage).toBe(1_000_000);
      expect(res.byDistrict.map((d) => d.id)).toEqual(['d1']);
      expect(res.byNeighborhood).toHaveLength(1);
      expect(res.byNeighborhood[0].count).toBe(1);
    });

    it('exportExcel builds 3 sheets, sanitizes formula injection, escapes search wildcards, and adds SUM formulas', async () => {
      const qb = createMockQb({
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'dc-1',
            case_number: 'AJ-2026-0001',
            title: '=CMD|calc',
            detected_at: new Date('2026-11-20T00:00:00.000Z'),
            qualification_type: DetectedCrimeQualification.CRIMINAL,
            estimated_damage: 750_000,
            suspects: [
              {
                role_in_crime: 'TASHKILOTCHI',
                detention_status: 'USHLANGAN',
                is_repeat_offender: true,
                citizen: { full_name: 'Ali Valiyev', passport: 'AA1234567' },
              },
            ],
            evidences: [
              { evidence_type: 'PHONE', title: 'Samsung S24', identifier_value: 'IMEI-123' },
            ],
          },
        ]),
      });
      repo.createQueryBuilder.mockReturnValue(qb);

      const chunks: Buffer[] = [];
      const setHeader = jest.fn();
      const end = jest.fn();
      const res = {
        setHeader,
        end,
        write: jest.fn((c: Buffer | Uint8Array | string) => {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
          return true;
        }),
        on: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      } as unknown as Response;

      await service.exportExcel({ search: '100%_test' }, res, ADMIN_USER);

      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :q'), {
        q: '%100\\%\\_test%',
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.concat(chunks) as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual([
        'Aniqlangan jinoyatlar',
        'Gumonlanuvchilar',
        'Ashyoviy dalillar',
      ]);
      const ws1 = wb.getWorksheet('Aniqlangan jinoyatlar')!;
      expect(ws1.getRow(2).getCell(4).value).toBe("'=CMD|calc");
      expect(ws1.getRow(3).getCell(14).value).toEqual({ formula: 'SUM(N2:N2)' });
      expect(end).toHaveBeenCalled();
    });
  });
});
