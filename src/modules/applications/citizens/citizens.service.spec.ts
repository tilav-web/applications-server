import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { Repository } from 'typeorm';

import { Role } from '../../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import type { IntelligenceSyncService } from '../../intelligence/intelligence-sync.service';
import type { User } from '../../users/user.entity';
import type { Citizen } from './citizen.entity';
import { CitizensService } from './citizens.service';

interface MockQueryBuilder {
  select: jest.Mock;
  addSelect: jest.Mock;
  innerJoin: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  addGroupBy: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  limit: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
}

function createMockQb(overrides?: Partial<MockQueryBuilder>): MockQueryBuilder {
  const qb: MockQueryBuilder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    innerJoin: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    limit: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  for (const key of [
    'select',
    'addSelect',
    'innerJoin',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'skip',
    'take',
    'limit',
  ] as const) {
    if (!overrides?.[key]) qb[key].mockReturnValue(qb);
  }
  return qb;
}

const ADMIN_USER: JwtAccessPayload = {
  sub: 'auth-admin',
  username: 'admin',
  role: Role.ADMIN,
};

const OFFICER_USER: JwtAccessPayload = {
  sub: 'auth-officer',
  username: 'officer',
  role: Role.DISTRICT_OFFICER,
};

describe('CitizensService', () => {
  let service: CitizensService;
  let citizenRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { query: jest.Mock };
  };
  let userRepo: { findOne: jest.Mock };
  let excelService: { generateWorkbook: jest.Mock };
  let intelligenceSync: {
    syncCitizenEntity: jest.Mock;
    syncApplicationsByCitizenId: jest.Mock;
  };

  beforeEach(() => {
    citizenRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data: Partial<Citizen>) => ({ ...data })),
      save: jest.fn((entity: Partial<Citizen>) => Promise.resolve({ id: 'cit-1', ...entity })),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
      manager: { query: jest.fn().mockResolvedValue([{ cnt: 0 }]) },
    };
    userRepo = { findOne: jest.fn() };
    excelService = {
      generateWorkbook: jest.fn().mockResolvedValue({
        xlsx: { write: jest.fn().mockResolvedValue(undefined) },
      }),
    };
    intelligenceSync = {
      syncCitizenEntity: jest.fn().mockResolvedValue(undefined),
      syncApplicationsByCitizenId: jest.fn().mockResolvedValue(undefined),
    };

    service = new CitizensService(
      citizenRepo as unknown as Repository<Citizen>,
      userRepo as unknown as Repository<User>,
      excelService,
      intelligenceSync as unknown as IntelligenceSyncService,
    );
  });

  describe('create (deduplication & normalization)', () => {
    it('normalizes passport, pinfl, phone, and legacy name parts into formatted full_name', async () => {
      citizenRepo.findOne.mockResolvedValue(null);

      const saved = await service.create({
        last_name: 'TILOVOV',
        first_name: 'SHAVQIDDIN',
        middle_name: "SAYFIDDIN O'G'LI",
        passport: ' ab 123-4567 ',
        pinfl: '312 0199 001 0023',
        phone_number: '+998 (90) 123-45-67',
      });

      expect(citizenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          full_name: "Tilovov Shavqiddin Sayfiddin o'g'li",
          passport: 'AB1234567',
          pinfl: '31201990010023',
          phone_number: '998901234567',
        }),
      );
      const createCalls = citizenRepo.create.mock.calls as Array<[Record<string, unknown>]>;
      const createdArg = createCalls[0][0];
      expect(createdArg).not.toHaveProperty('first_name');
      expect(createdArg).not.toHaveProperty('last_name');
      expect(createdArg).not.toHaveProperty('middle_name');
      expect(intelligenceSync.syncCitizenEntity).toHaveBeenCalledWith(saved);
    });

    it('returns existing citizen by passport without creating duplicate or syncing', async () => {
      const existing = { id: 'cit-existing', passport: 'AA1234567' } as Citizen;
      citizenRepo.findOne.mockResolvedValueOnce(existing);

      const res = await service.create({
        full_name: 'Ali Valiyev',
        passport: 'aa 1234567',
        pinfl: '12345678901234',
      });

      expect(res).toBe(existing);
      expect(citizenRepo.findOne).toHaveBeenCalledTimes(1);
      expect(citizenRepo.save).not.toHaveBeenCalled();
      expect(intelligenceSync.syncCitizenEntity).not.toHaveBeenCalled();
    });

    it('returns existing citizen by pinfl when passport does not match', async () => {
      const existing = { id: 'cit-pinfl', pinfl: '30101900010011' } as Citizen;
      citizenRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

      const res = await service.create({
        passport: 'AB9999999',
        pinfl: '3010-1900-010011',
      });

      expect(res).toBe(existing);
      expect(citizenRepo.save).not.toHaveBeenCalled();
    });

    it('returns existing citizen by phone + formatted full_name when phone has >= 7 digits', async () => {
      const existing = {
        id: 'cit-phone',
        phone_number: '998901112233',
        full_name: 'Karimov Jasur',
      } as Citizen;
      citizenRepo.findOne.mockResolvedValueOnce(existing);

      const res = await service.create({
        full_name: 'KARIMOV JASUR',
        phone_number: '90 111 22 33',
      });

      expect(res).toBe(existing);
      expect(citizenRepo.findOne).toHaveBeenCalledWith({
        where: { phone_number: '998901112233', full_name: 'Karimov Jasur' },
      });
      expect(citizenRepo.save).not.toHaveBeenCalled();
    });

    it('does NOT deduplicate on short phone numbers (< 7 digits)', async () => {
      citizenRepo.findOne.mockResolvedValue(null);

      await service.create({
        full_name: 'Karimov Jasur',
        phone_number: '12345',
      });

      expect(citizenRepo.findOne).not.toHaveBeenCalled();
      expect(citizenRepo.save).toHaveBeenCalledTimes(1);
    });

    it('recovers gracefully from concurrent PG unique violation (23505) on save', async () => {
      const raceWinner = { id: 'cit-race', passport: 'AD7777777' } as Citizen;
      citizenRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(raceWinner);
      citizenRepo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });

      const res = await service.create({ passport: 'ad7777777', full_name: 'Test User' });

      expect(res).toBe(raceWinner);
      expect(intelligenceSync.syncCitizenEntity).not.toHaveBeenCalled();
    });

    it('rethrows non-unique database errors during save', async () => {
      citizenRepo.findOne.mockResolvedValue(null);
      citizenRepo.save.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(service.create({ full_name: 'Test' })).rejects.toThrow('DB connection lost');
    });
  });

  describe('findAll & district scope & LIKE escaping', () => {
    it('escapes SQL LIKE wildcards in search/filters, clamps invalid pagination, and preserves id order', async () => {
      const qb = createMockQb({
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'cit-2' }, { id: 'cit-1' }], 2]),
      });
      citizenRepo.createQueryBuilder.mockReturnValue(qb);
      citizenRepo.find.mockResolvedValue([
        { id: 'cit-1', full_name: 'First', applications: [] },
        { id: 'cit-2', full_name: 'Second', applications: [] },
      ]);

      const res = await service.findAll(
        0,
        -10,
        '100%_test\\name',
        { passport: 'AB_12%' },
        ADMIN_USER,
      );

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(1);
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :q'), {
        q: '%100\\%\\_test\\\\name%',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('citizen.passport ILIKE :passport', {
        passport: '%AB\\_12\\%%',
      });
      expect(res.items.map((i) => i.id)).toEqual(['cit-2', 'cit-1']);
      expect(res.meta).toEqual({
        total: 2,
        page: 1,
        limit: 1,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('fails closed (1 = 0) when DISTRICT_OFFICER has no assigned districts', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });
      const qb = createMockQb();
      citizenRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.findAll(1, 10, undefined, undefined, OFFICER_USER);

      expect(qb.andWhere).toHaveBeenCalledWith('1 = 0');
      expect(res.items).toEqual([]);
      expect(res.meta.totalPages).toBe(1);
    });

    it('filters out deleted and cross-district applications in findAll for DISTRICT_OFFICER', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const qb = createMockQb({
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'cit-1' }], 1]),
      });
      citizenRepo.createQueryBuilder.mockReturnValue(qb);
      citizenRepo.find.mockResolvedValue([
        {
          id: 'cit-1',
          district_id: 'dist-1',
          applications: [
            { id: 'app-ok', district_id: 'dist-1', is_deleted: false },
            { id: 'app-del', district_id: 'dist-1', is_deleted: true },
            { id: 'app-other', district_id: 'dist-2', is_deleted: false },
          ],
        },
      ]);

      const res = await service.findAll(1, 10, undefined, undefined, OFFICER_USER);

      expect(res.items[0].applications.map((a) => a.id)).toEqual(['app-ok']);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when citizen does not exist', async () => {
      citizenRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing-id', ADMIN_USER)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when DISTRICT_OFFICER accesses citizen outside their districts', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      citizenRepo.findOne.mockResolvedValue({
        id: 'cit-other',
        district_id: 'dist-2',
        applications: [
          { id: 'app-del', district_id: 'dist-1', is_deleted: true },
          { id: 'app-other', district_id: 'dist-2', is_deleted: false },
        ],
      });

      await expect(service.findOne('cit-other', OFFICER_USER)).rejects.toThrow(ForbiddenException);
    });

    it('allows DISTRICT_OFFICER access when citizen has an active application in their district and filters applications', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      citizenRepo.findOne.mockResolvedValue({
        id: 'cit-shared',
        district_id: 'dist-2',
        applications: [
          { id: 'app-1', district_id: 'dist-1', is_deleted: false },
          { id: 'app-2', district_id: 'dist-2', is_deleted: false },
        ],
      });

      const res = await service.findOne('cit-shared', OFFICER_USER);
      expect(res.applications.map((a) => a.id)).toEqual(['app-1']);
    });
  });

  describe('update', () => {
    it('throws ConflictException when updating passport to another citizen passport', async () => {
      citizenRepo.findOne
        .mockResolvedValueOnce({ id: 'cit-1', passport: 'AA1111111', applications: [] })
        .mockResolvedValueOnce({ id: 'cit-2', passport: 'BB2222222' });

      await expect(service.update('cit-1', { passport: 'bb 2222222' }, ADMIN_USER)).rejects.toThrow(
        ConflictException,
      );
      expect(citizenRepo.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when updating pinfl to another citizen pinfl', async () => {
      citizenRepo.findOne
        .mockResolvedValueOnce({ id: 'cit-1', pinfl: '11111111111111', applications: [] })
        .mockResolvedValueOnce({ id: 'cit-2', pinfl: '22222222222222' });

      await expect(
        service.update('cit-1', { pinfl: '2222 2222 2222 22' }, ADMIN_USER),
      ).rejects.toThrow(ConflictException);
    });

    it('clears stale relation objects, syncs applications when phone changes, and filters returned apps for DISTRICT_OFFICER', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const loadedCitizen = {
        id: 'cit-1',
        district_id: 'dist-1',
        district: { id: 'dist-1' },
        neighborhood: { id: 'nb-1' },
        cards: [],
        phones: [],
        digital_identifiers: [],
        applications: [{ id: 'app-1', district_id: 'dist-1', is_deleted: false }],
      };
      const reloadedCitizen = {
        id: 'cit-1',
        district_id: 'dist-2',
        phone_number: '998901234567',
        applications: [
          { id: 'app-1', district_id: 'dist-1', is_deleted: false },
          { id: 'app-secret', district_id: 'dist-2', is_deleted: false },
        ],
      };

      citizenRepo.findOne
        .mockResolvedValueOnce(loadedCitizen)
        .mockResolvedValueOnce(reloadedCitizen);
      citizenRepo.save.mockImplementation((entity: Record<string, unknown>) => {
        expect(entity.district).toBeUndefined();
        expect(entity.cards).toBeUndefined();
        expect(entity.applications).toBeUndefined();
        return Promise.resolve(entity);
      });

      const res = await service.update(
        'cit-1',
        { district_id: 'dist-2', phone_number: '90 123 45 67' },
        OFFICER_USER,
      );

      expect(intelligenceSync.syncCitizenEntity).toHaveBeenCalledTimes(1);
      expect(intelligenceSync.syncApplicationsByCitizenId).toHaveBeenCalledWith('cit-1');
      expect(res.applications.map((a) => a.id)).toEqual(['app-1']);
    });

    it('does NOT call syncApplicationsByCitizenId when phone_number is unchanged', async () => {
      citizenRepo.findOne
        .mockResolvedValueOnce({ id: 'cit-1', address: 'Old', applications: [] })
        .mockResolvedValueOnce({ id: 'cit-1', address: 'New', applications: [] });

      await service.update('cit-1', { address: 'New' }, ADMIN_USER);

      expect(intelligenceSync.syncCitizenEntity).toHaveBeenCalledTimes(1);
      expect(intelligenceSync.syncApplicationsByCitizenId).not.toHaveBeenCalled();
    });

    it('converts concurrent PG 23505 on update save into ConflictException', async () => {
      citizenRepo.findOne
        .mockResolvedValueOnce({ id: 'cit-1', passport: null, applications: [] })
        .mockResolvedValueOnce(null);
      citizenRepo.save.mockRejectedValueOnce({ code: '23505' });

      await expect(service.update('cit-1', { passport: 'CC3333333' }, ADMIN_USER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('blocks deletion with ConflictException when citizen has dependent records', async () => {
      citizenRepo.findOne.mockResolvedValue({ id: 'cit-1', full_name: 'Ali Valiyev' });
      citizenRepo.manager.query
        .mockResolvedValueOnce([{ cnt: 2 }]) // applications
        .mockResolvedValueOnce([{ cnt: 1 }]) // cards
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 0 }]);

      await expect(service.remove('cit-1')).rejects.toThrow(ConflictException);
      expect(citizenRepo.remove).not.toHaveBeenCalled();
    });

    it('deletes citizen cleanly when there are zero dependencies', async () => {
      const entity = { id: 'cit-1', full_name: 'Ali Valiyev' } as Citizen;
      citizenRepo.findOne.mockResolvedValue(entity);
      citizenRepo.manager.query.mockResolvedValue([{ cnt: 0 }]);

      const res = await service.remove('cit-1');

      expect(citizenRepo.remove).toHaveBeenCalledWith(entity);
      expect(res.success).toBe(true);
    });
  });

  describe('exportToExcel', () => {
    it('filters applications for DISTRICT_OFFICER and writes Excel headers to response', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const qb = createMockQb({
        getMany: jest.fn().mockResolvedValue([{ id: 'cit-1' }]),
      });
      citizenRepo.createQueryBuilder.mockReturnValue(qb);
      citizenRepo.find.mockResolvedValue([
        {
          id: 'cit-1',
          applications: [
            { id: 'app-1', district_id: 'dist-1', is_deleted: false },
            { id: 'app-2', district_id: 'dist-9', is_deleted: false },
          ],
        },
      ]);

      const setHeader = jest.fn();
      const end = jest.fn();
      const res = {
        setHeader,
        end,
      } as unknown as Response;

      await service.exportToExcel(undefined, undefined, res, OFFICER_USER);

      const excelCalls = excelService.generateWorkbook.mock.calls as Array<[Citizen[]]>;
      const exportedItems = excelCalls[0][0];
      expect(exportedItems[0].applications.map((a) => a.id)).toEqual(['app-1']);
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('Fuqarolar_Bazasi_'),
      );
      expect(end).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('computes summary stats, percentages, fallback names, and applies district scope to both queries', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const summaryQb = createMockQb({
        getRawOne: jest.fn().mockResolvedValue({
          total: '40',
          maleCount: '25',
          femaleCount: '15',
          withPhoneCount: '38',
          withPassportCount: '30',
          withCardsCount: '18',
        }),
      });
      const distQb = createMockQb({
        getRawMany: jest.fn().mockResolvedValue([
          { id: 'dist-1', name: 'Qarshi shahri', count: '10' },
          { id: 'dist-2', name: null, count: '5' },
        ]),
      });
      citizenRepo.createQueryBuilder.mockReturnValueOnce(summaryQb).mockReturnValueOnce(distQb);

      const stats = await service.getStats(OFFICER_USER);

      expect(summaryQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('allowedDistrictIds'),
        { allowedDistrictIds: ['dist-1'] },
      );
      expect(distQb.andWhere).toHaveBeenCalledWith(expect.stringContaining('allowedDistrictIds'), {
        allowedDistrictIds: ['dist-1'],
      });
      expect(stats).toEqual({
        total: 40,
        maleCount: 25,
        femaleCount: 15,
        withPhoneCount: 38,
        withPassportCount: 30,
        withCardsCount: 18,
        topDistricts: [
          { id: 'dist-1', name: 'Qarshi shahri', count: 10, percent: 25 },
          { id: 'dist-2', name: 'Noma‘lum tuman', count: 5, percent: 13 },
        ],
      });
    });

    it('handles empty table (total = 0) without NaN percentages', async () => {
      const summaryQb = createMockQb({ getRawOne: jest.fn().mockResolvedValue({ total: '0' }) });
      const distQb = createMockQb({ getRawMany: jest.fn().mockResolvedValue([]) });
      citizenRepo.createQueryBuilder.mockReturnValueOnce(summaryQb).mockReturnValueOnce(distQb);

      const stats = await service.getStats(ADMIN_USER);

      expect(stats.total).toBe(0);
      expect(stats.topDistricts).toEqual([]);
    });
  });
});
