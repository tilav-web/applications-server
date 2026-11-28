import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { Repository } from 'typeorm';

import { Role } from '../../../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../../../common/types/jwt-payload.interface';
import type { IntelligenceSyncService } from '../../../intelligence/intelligence-sync.service';
import type { User } from '../../../users/user.entity';
import type { Card } from './card.entity';
import { CardsService } from './cards.service';

interface MockQueryBuilder {
  select: jest.Mock;
  addSelect: jest.Mock;
  leftJoin: jest.Mock;
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  addGroupBy: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  limit: jest.Mock;
  getOne: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
}

function createMockQb(overrides?: Partial<MockQueryBuilder>): MockQueryBuilder {
  const qb: MockQueryBuilder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    leftJoin: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    limit: jest.fn(),
    getOne: jest.fn().mockResolvedValue(null),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  for (const key of [
    'select',
    'addSelect',
    'leftJoin',
    'innerJoin',
    'where',
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

const ADMIN_USER: JwtAccessPayload = { sub: 'auth-admin', username: 'admin', role: Role.ADMIN };
const OFFICER_USER: JwtAccessPayload = {
  sub: 'auth-officer',
  username: 'officer',
  role: Role.DISTRICT_OFFICER,
};

describe('CardsService', () => {
  let service: CardsService;
  let cardRepo: {
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
  let intelligenceSync: { syncApplicationsByCardId: jest.Mock };

  beforeEach(() => {
    cardRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data: Partial<Card>) => ({ ...data })),
      save: jest.fn((entity: Partial<Card>) => Promise.resolve({ id: 'card-1', ...entity })),
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
    intelligenceSync = { syncApplicationsByCardId: jest.fn().mockResolvedValue(undefined) };

    service = new CardsService(
      cardRepo as unknown as Repository<Card>,
      userRepo as unknown as Repository<User>,
      excelService,
      intelligenceSync as unknown as IntelligenceSyncService,
    );
  });

  describe('create (deduplication, enrichment & TypeORM relation safety)', () => {
    it('strips non-digits from card_number and formats full_name on new card creation', async () => {
      cardRepo.findOne.mockResolvedValue(null);

      await service.create({
        card_number: '8600 1234-5678 9012',
        full_name: 'KARIMOV ALISHER',
      });

      expect(cardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          card_number: '8600123456789012',
          full_name: 'Karimov Alisher',
        }),
      );
    });

    it('merges only missing fields onto existing card, strips stale citizen/bank relations, and syncs intelligence', async () => {
      const existing = {
        id: 'card-existing',
        card_number: '8600123456789012',
        citizen_id: null,
        citizen: null,
        bank_id: null,
        bank: null,
        full_name: 'Old Name',
        expire_date: null,
      } as unknown as Card;
      cardRepo.findOne.mockResolvedValue(existing);
      cardRepo.save.mockImplementation((entity: Record<string, unknown>) => {
        // Stale loaded null relations must be deleted so TypeORM persists the new FKs
        expect('citizen' in entity).toBe(false);
        expect('bank' in entity).toBe(false);
        return Promise.resolve(entity);
      });

      const result = await service.create({
        card_number: '8600-1234-5678-9012',
        citizen_id: 'cit-9',
        bank_id: 'bank-3',
        full_name: 'NEW NAME SHOULD NOT OVERWRITE',
        expire_date: '12/28',
      });

      expect(result.citizen_id).toBe('cit-9');
      expect(result.bank_id).toBe('bank-3');
      expect(result.full_name).toBe('Old Name');
      expect(result.expire_date).toBe('12/28');
      expect(intelligenceSync.syncApplicationsByCardId).toHaveBeenCalledWith('card-existing');
    });

    it('returns existing card as-is without calling save if no fields are missing', async () => {
      const existing = {
        id: 'card-1',
        card_number: '9860111122223333',
        citizen_id: 'cit-1',
        bank_id: 'bank-1',
        full_name: 'Existing Owner',
        expire_date: '05/27',
      } as Card;
      cardRepo.findOne.mockResolvedValue(existing);

      const res = await service.create({
        card_number: '9860 1111 2222 3333',
        citizen_id: 'cit-other',
      });

      expect(res).toBe(existing);
      expect(cardRepo.save).not.toHaveBeenCalled();
      expect(intelligenceSync.syncApplicationsByCardId).not.toHaveBeenCalled();
    });

    it('skips deduplication lookup for short (< 8 digits) or empty card numbers', async () => {
      await service.create({ card_number: '   ' });

      expect(cardRepo.findOne).not.toHaveBeenCalled();
      expect(cardRepo.create).toHaveBeenCalledWith(expect.objectContaining({ card_number: null }));
    });

    it('handles concurrent PG 23505 unique violation by attaching to existing card', async () => {
      const existing = { id: 'card-race', card_number: '8600999988887777' } as Card;
      cardRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
      cardRepo.save.mockRejectedValueOnce({ code: '23505' });

      const res = await service.create({ card_number: '8600999988887777' });
      expect(res).toBe(existing);
    });
  });

  describe('findAll & filtering & district scope', () => {
    it('applies ownerState, LIKE escaping, digit search, pagination clamping, and exact order preservation', async () => {
      const qb = createMockQb({
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'c2' }, { id: 'c1' }], 2]),
      });
      cardRepo.createQueryBuilder.mockReturnValue(qb);
      cardRepo.find.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      const res = await service.findAll(
        -2,
        0,
        '8600_12%',
        'cit-1',
        { ownerState: 'unattached', bankId: 'bank-1', ownerName: 'Ali_%' },
        ADMIN_USER,
      );

      expect(qb.andWhere).toHaveBeenCalledWith('card.citizen_id IS NULL');
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('digitsQ'), {
        q: '%8600\\_12\\%%',
        digitsQ: '%860012%',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ownerQ'), {
        ownerQ: '%Ali\\_\\%%',
      });
      expect(res.items.map((c) => c.id)).toEqual(['c2', 'c1']);
      expect(res.meta.page).toBe(1);
      expect(res.meta.limit).toBe(1);
    });

    it('fails closed (1 = 0) when DISTRICT_OFFICER has empty assigned districts', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });
      const qb = createMockQb();
      cardRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(1, 10, undefined, undefined, undefined, OFFICER_USER);
      expect(qb.andWhere).toHaveBeenCalledWith('1 = 0');
    });
  });

  describe('findOne', () => {
    it('throws ForbiddenException when DISTRICT_OFFICER cannot access card', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const checkQb = createMockQb({ getOne: jest.fn().mockResolvedValue(null) });
      cardRepo.createQueryBuilder.mockReturnValue(checkQb);

      await expect(service.findOne('card-x', OFFICER_USER)).rejects.toThrow(ForbiddenException);
    });

    it('filters applications by allowedDistrictIds for DISTRICT_OFFICER when accessible', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const checkQb = createMockQb({ getOne: jest.fn().mockResolvedValue({ id: 'card-1' }) });
      cardRepo.createQueryBuilder.mockReturnValue(checkQb);
      cardRepo.findOne.mockResolvedValue({
        id: 'card-1',
        applications: [
          { id: 'app-ok', district_id: 'dist-1', is_deleted: false },
          { id: 'app-del', district_id: 'dist-1', is_deleted: true },
          { id: 'app-other', district_id: 'dist-2', is_deleted: false },
        ],
      });

      const card = await service.findOne('card-1', OFFICER_USER);
      expect(card.applications.map((a) => a.id)).toEqual(['app-ok']);
    });

    it('throws NotFoundException for ADMIN when card does not exist', async () => {
      cardRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing', ADMIN_USER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects duplicate card_number belonging to another card with ConflictException', async () => {
      cardRepo.findOne
        .mockResolvedValueOnce({ id: 'card-1', card_number: '8600111111111111', applications: [] })
        .mockResolvedValueOnce({ id: 'card-2', card_number: '8600222222222222' });

      await expect(
        service.update('card-1', { card_number: '8600 2222 2222 2222' }, ADMIN_USER),
      ).rejects.toThrow(ConflictException);
      expect(cardRepo.save).not.toHaveBeenCalled();
    });

    it('normalizes empty card_number to null, clears stale relations, syncs intelligence, and filters returned apps for officer', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const checkQb = createMockQb({ getOne: jest.fn().mockResolvedValue({ id: 'card-1' }) });
      cardRepo.createQueryBuilder.mockReturnValue(checkQb);

      cardRepo.findOne
        .mockResolvedValueOnce({
          id: 'card-1',
          bank: { id: 'b1' },
          citizen: { id: 'c1' },
          applications: [],
        })
        .mockResolvedValueOnce({
          id: 'card-1',
          card_number: null,
          applications: [
            { id: 'app-1', district_id: 'dist-1', is_deleted: false },
            { id: 'app-2', district_id: 'dist-2', is_deleted: false },
          ],
        });

      cardRepo.save.mockImplementation((entity: Record<string, unknown>) => {
        expect(entity.bank).toBeUndefined();
        expect(entity.citizen).toBeUndefined();
        expect(entity.applications).toBeUndefined();
        expect(entity.card_number).toBeNull();
        return Promise.resolve(entity);
      });

      const updated = await service.update(
        'card-1',
        { card_number: '   ', bank_id: 'b2', citizen_id: 'c2' },
        OFFICER_USER,
      );

      expect(intelligenceSync.syncApplicationsByCardId).toHaveBeenCalledWith('card-1');
      expect(updated.applications.map((a) => a.id)).toEqual(['app-1']);
    });

    it('does NOT sync intelligence when only expire_date is updated', async () => {
      cardRepo.findOne
        .mockResolvedValueOnce({ id: 'card-1', applications: [] })
        .mockResolvedValueOnce({ id: 'card-1', expire_date: '09/29', applications: [] });

      await service.update('card-1', { expire_date: '09/29' }, ADMIN_USER);
      expect(intelligenceSync.syncApplicationsByCardId).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('blocks deletion with ConflictException when card is linked to transfers or applications', async () => {
      cardRepo.findOne.mockResolvedValue({ id: 'card-1', card_number: '8600123412341234' });
      cardRepo.manager.query
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 3 }]) // sender transfers
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 0 }]);

      await expect(service.remove('card-1')).rejects.toThrow(ConflictException);
      expect(cardRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('exportToExcel', () => {
    it('restricts applications & transfer app labels by district scope and sums only UZS transfers', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const qb = createMockQb({ getMany: jest.fn().mockResolvedValue([{ id: 'card-1' }]) });
      cardRepo.createQueryBuilder.mockReturnValue(qb);
      cardRepo.find.mockResolvedValue([
        {
          id: 'card-1',
          applications: [
            {
              id: 'app-1',
              application_number: '2026-00001',
              district_id: 'dist-1',
              is_deleted: false,
            },
            {
              id: 'app-2',
              application_number: '2026-99999',
              district_id: 'dist-2',
              is_deleted: false,
            },
          ],
        },
      ]);
      cardRepo.manager.query.mockResolvedValue([
        {
          sender_card_id: 'card-1',
          receiver_card_id: 'card-2',
          amount: '500000',
          currency: 'UZS',
          app_id: 'app-1',
          app_num: '2026-00001',
        },
        {
          sender_card_id: 'card-1',
          receiver_card_id: 'card-2',
          amount: '100',
          currency: 'USD',
          app_id: 'app-3',
          app_num: null,
        },
      ]);

      const res = { setHeader: jest.fn(), end: jest.fn() } as unknown as Response;
      await service.exportToExcel(undefined, undefined, res, undefined, OFFICER_USER);

      // SQL query must filter applications by allowedDistrictIds
      expect(cardRepo.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('a1.district_id = ANY($2::uuid[])'),
        [['card-1'], ['dist-1']],
      );
      const [exportedItems, statsMap] = excelService.generateWorkbook.mock.calls[0] as [
        Card[],
        Map<
          string,
          {
            outgoingCount: number;
            outgoingAmount: number;
            incomingCount: number;
            appNumbers: Set<string>;
          }
        >,
      ];
      expect(exportedItems[0].applications.map((a) => a.id)).toEqual(['app-1']);
      const st = statsMap.get('card-1')!;
      expect(st.outgoingCount).toBe(2);
      expect(st.outgoingAmount).toBe(500000); // USD excluded from UZS sum
      expect(Array.from(st.appNumbers)).toEqual(['2026-00001', 'AR-app-3']);
    });
  });

  describe('getStats', () => {
    it('joins card.citizen on both summaryQb and bankQb so DISTRICT_OFFICER scope never crashes', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const summaryQb = createMockQb({
        getRawOne: jest.fn().mockResolvedValue({
          total: '20',
          attachedCount: '12',
          unattachedCount: '8',
          uzcardCount: '10',
          humoCount: '6',
          visaMasterCount: '2',
        }),
      });
      const bankQb = createMockQb({
        getRawMany: jest.fn().mockResolvedValue([
          { id: 'b-1', name: 'Agrobank', count: '10' },
          { id: 'b-2', name: null, count: '4' },
        ]),
      });
      cardRepo.createQueryBuilder.mockReturnValueOnce(summaryQb).mockReturnValueOnce(bankQb);

      const stats = await service.getStats(OFFICER_USER);

      expect(summaryQb.leftJoin).toHaveBeenCalledWith('card.citizen', 'citizen');
      expect(bankQb.leftJoin).toHaveBeenCalledWith('card.citizen', 'citizen');
      expect(stats).toEqual({
        total: 20,
        attachedCount: 12,
        unattachedCount: 8,
        uzcardCount: 10,
        humoCount: 6,
        visaMasterCount: 2,
        otherSystemCount: 2,
        topBanks: [
          { id: 'b-1', name: 'Agrobank', count: 10, percent: 50 },
          { id: 'b-2', name: 'Noma‘lum bank', count: 4, percent: 20 },
        ],
      });
    });

    it('clamps otherSystemCount to 0 and handles empty stats cleanly', async () => {
      const summaryQb = createMockQb({
        getRawOne: jest.fn().mockResolvedValue({
          total: '0',
          uzcardCount: '0',
          humoCount: '0',
          visaMasterCount: '0',
        }),
      });
      const bankQb = createMockQb({ getRawMany: jest.fn().mockResolvedValue([]) });
      cardRepo.createQueryBuilder.mockReturnValueOnce(summaryQb).mockReturnValueOnce(bankQb);

      const stats = await service.getStats(ADMIN_USER);
      expect(stats.otherSystemCount).toBe(0);
      expect(stats.topBanks).toEqual([]);
    });
  });
});
