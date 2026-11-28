import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { Role } from '../../../common/enums/role.enum';
import { TransferDestinationType } from '../../../common/enums/transfer-destination-type.enum';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import type { DigitalIdentifierEntity } from '../../intelligence/entities/digital-identifier.entity';
import type { IntelligenceSyncService } from '../../intelligence/intelligence-sync.service';
import type { User } from '../../users/user.entity';
import type { TransferCustomField } from './custom-fields/transfer-custom-field.entity';
import type { Transfer } from './transfer.entity';
import { TransfersService } from './transfers.service';

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

describe('TransfersService', () => {
  let service: TransfersService;
  let transferRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { query: jest.Mock; transaction: jest.Mock };
  };
  let customFieldRepo: { create: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let identifierRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let excelService: { generateWorkbook: jest.Mock };
  let intelligenceSync: { syncApplicationById: jest.Mock };

  beforeEach(() => {
    customFieldRepo = {
      create: jest.fn((d: Partial<TransferCustomField>) => ({ ...d })),
      save: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    transferRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((d: Partial<Transfer>) => ({ ...d })),
      save: jest.fn((e: Partial<Transfer>) => Promise.resolve({ id: 'tr-1', ...e })),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
      manager: {
        query: jest.fn().mockResolvedValue([{ cnt: 0 }]),
        transaction: jest.fn(async (cb: (mgr: { getRepository: jest.Mock }) => Promise<void>) => {
          const mgr = {
            getRepository: jest.fn((entity: { name?: string }) =>
              entity?.name === 'Transfer' ? transferRepo : customFieldRepo,
            ),
          };
          await cb(mgr);
        }),
      },
    };
    identifierRepo = {
      findOne: jest.fn(),
      create: jest.fn((d: Partial<DigitalIdentifierEntity>) => ({ ...d })),
      save: jest.fn((e: Partial<DigitalIdentifierEntity>) =>
        Promise.resolve({ id: 'ident-1', ...e }),
      ),
    };
    userRepo = { findOne: jest.fn() };
    excelService = {
      generateWorkbook: jest.fn().mockResolvedValue({
        xlsx: { write: jest.fn().mockResolvedValue(undefined) },
      }),
    };
    intelligenceSync = { syncApplicationById: jest.fn().mockResolvedValue(undefined) };

    service = new TransfersService(
      transferRepo as unknown as Repository<Transfer>,
      customFieldRepo as unknown as Repository<TransferCustomField>,
      identifierRepo as unknown as Repository<DigitalIdentifierEntity>,
      userRepo as unknown as Repository<User>,
      excelService,
      intelligenceSync as unknown as IntelligenceSyncService,
    );
  });

  describe('create (destination resolution, crypto/platform/cash, race safety)', () => {
    it('resolves CRYPTO destination into digital_identifiers, clears receiver_card_id, saves custom fields, and syncs intelligence', async () => {
      identifierRepo.findOne.mockResolvedValue(null);
      transferRepo.findOne.mockResolvedValue({
        id: 'tr-1',
        destination_type: TransferDestinationType.CRYPTO,
        receiver_card_id: null,
        receiver_identifier_id: 'ident-1',
      });

      await service.create({
        application_id: 'app-1',
        sender_card_id: 'card-1',
        receiver_card_id: 'card-should-be-cleared',
        amount: 2500000,
        destination_type: TransferDestinationType.CRYPTO,
        destination_platform: 'Binance',
        destination_value: 'TXYZ1234567890',
        custom_fields: [{ field_name: 'tx_hash', field_value: '0xabc' } as never],
      });

      expect(identifierRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crypto_wallet',
          type_label: 'Binance',
          raw_value: 'TXYZ1234567890',
        }),
      );
      expect(transferRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_type: TransferDestinationType.CRYPTO,
          receiver_card_id: null,
          receiver_identifier_id: 'ident-1',
          destination_label: 'Binance: TXYZ1234567890',
          destination_details: { platform: 'Binance', value: 'TXYZ1234567890' },
        }),
      );
      expect(customFieldRepo.save).toHaveBeenCalledTimes(1);
      expect(intelligenceSync.syncApplicationById).toHaveBeenCalledWith('app-1');
    });

    it('recovers from concurrent PG 23505 when creating DigitalIdentifierEntity', async () => {
      identifierRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'ident-race', type: 'crypto_wallet' });
      identifierRepo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      transferRepo.findOne.mockResolvedValue({ id: 'tr-1', receiver_identifier_id: 'ident-race' });

      await service.create({
        destination_type: TransferDestinationType.CRYPTO,
        destination_platform: 'Bybit',
        destination_value: 'TWallet999',
      });

      expect(transferRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ receiver_identifier_id: 'ident-race' }),
      );
    });

    it('creates PLATFORM identifier with sanitized slug type and does NOT create identifier for CASH', async () => {
      identifierRepo.findOne.mockResolvedValue(null);
      transferRepo.findOne.mockResolvedValue({ id: 'tr-1' });

      await service.create({
        destination_type: TransferDestinationType.PLATFORM,
        destination_platform: '1xBet Pro!',
        destination_value: 'uid_778899',
      });
      expect(identifierRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'platform_1xbet_pro_' }),
      );

      identifierRepo.create.mockClear();
      await service.create({
        destination_type: TransferDestinationType.CASH,
        destination_value: 'ATM Qarshi',
      });
      expect(identifierRepo.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate transaction_id (23505)', async () => {
      transferRepo.save.mockRejectedValueOnce({ code: '23505' });

      await expect(service.create({ transaction_id: 'DUP-TX-001' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll & findOne', () => {
    it('escapes LIKE wildcards, clamps pagination, and preserves order', async () => {
      const qb = createMockQb({
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 't2' }, { id: 't1' }], 2]),
      });
      transferRepo.createQueryBuilder.mockReturnValue(qb);
      transferRepo.find.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

      const res = await service.findAll(0, -1, 'TX_99%', { transactionId: 'ID_1%' }, ADMIN_USER);

      expect(qb.andWhere).toHaveBeenCalledWith('transfer.transaction_id ILIKE :txId', {
        txId: '%ID\\_1\\%%',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('transfer.transaction_id ILIKE :q', {
        q: '%TX\\_99\\%%',
      });
      expect(res.items.map((t) => t.id)).toEqual(['t2', 't1']);
      expect(res.meta.page).toBe(1);
      expect(res.meta.limit).toBe(1);
    });

    it('throws ForbiddenException when DISTRICT_OFFICER accesses out-of-scope transfer', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const checkQb = createMockQb({ getOne: jest.fn().mockResolvedValue(null) });
      transferRepo.createQueryBuilder.mockReturnValue(checkQb);

      await expect(service.findOne('tr-other', OFFICER_USER)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for ADMIN when transfer does not exist', async () => {
      transferRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing', ADMIN_USER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('preserves destination_details when updating only destination_label on a CRYPTO transfer', async () => {
      const existing = {
        id: 'tr-1',
        application_id: 'app-1',
        destination_type: TransferDestinationType.CRYPTO,
        receiver_identifier_id: 'ident-1',
        destination_label: 'Old Label',
        destination_details: { platform: 'Binance', value: 'TRC20-ABC', source_type: 'CRYPTO' },
      };
      transferRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);

      await service.update('tr-1', { destination_label: 'Updated Label' }, ADMIN_USER);

      const saveCalls = transferRepo.save.mock.calls as Array<[Transfer]>;
      const savedTransfer = saveCalls[0][0];
      expect(savedTransfer.destination_label).toBe('Updated Label');
      expect(savedTransfer.destination_details).toEqual({
        platform: 'Binance',
        value: 'TRC20-ABC',
        source_type: 'CRYPTO',
      });
      expect(savedTransfer.receiver_identifier_id).toBe('ident-1');
    });

    it('clears stale receiver_identifier_id when switching destination_type from CRYPTO back to CARD', async () => {
      const existing = {
        id: 'tr-1',
        application_id: 'app-1',
        destination_type: TransferDestinationType.CRYPTO,
        receiver_identifier_id: 'ident-crypto',
        receiver_card_id: null,
        destination_details: { platform: 'Binance', value: 'TRC20' },
      };
      transferRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);

      await service.update(
        'tr-1',
        { destination_type: TransferDestinationType.CARD, receiver_card_id: 'card-99' },
        ADMIN_USER,
      );

      const saveCalls = transferRepo.save.mock.calls as Array<[Transfer]>;
      const savedTransfer = saveCalls[0][0];
      expect(savedTransfer.destination_type).toBe(TransferDestinationType.CARD);
      expect(savedTransfer.receiver_card_id).toBe('card-99');
      expect(savedTransfer.receiver_identifier_id).toBeNull();
    });

    it('syncs BOTH previous and next application_id when transfer is reassigned and replaces custom_fields transactionally', async () => {
      const existing = {
        id: 'tr-1',
        application_id: 'app-old',
        destination_type: TransferDestinationType.CARD,
      };
      transferRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);

      await service.update(
        'tr-1',
        {
          application_id: 'app-new',
          custom_fields: [{ field_name: 'note', field_value: 'v2' } as never],
        },
        ADMIN_USER,
      );

      expect(customFieldRepo.delete).toHaveBeenCalledWith({ transfer_id: 'tr-1' });
      expect(customFieldRepo.save).toHaveBeenCalledTimes(1);
      expect(intelligenceSync.syncApplicationById).toHaveBeenCalledWith('app-old');
      expect(intelligenceSync.syncApplicationById).toHaveBeenCalledWith('app-new');
    });

    it('converts PG 23505 during update transaction into ConflictException', async () => {
      transferRepo.findOne.mockResolvedValueOnce({
        id: 'tr-1',
        destination_type: TransferDestinationType.CARD,
      });
      transferRepo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });

      await expect(
        service.update('tr-1', { transaction_id: 'TAKEN-ID' }, ADMIN_USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('blocks deletion with ConflictException when linked to an active application', async () => {
      transferRepo.findOne.mockResolvedValue({ id: 'tr-1', transaction_id: 'TX-1' });
      transferRepo.manager.query
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ cnt: 0 }]);

      await expect(service.remove('tr-1')).rejects.toThrow(ConflictException);
      expect(transferRepo.remove).not.toHaveBeenCalled();
    });

    it('removes transfer and resyncs affected application when unreferenced', async () => {
      const tr = { id: 'tr-1', transaction_id: 'TX-1', application_id: 'app-1' };
      transferRepo.findOne.mockResolvedValue(tr);
      transferRepo.manager.query.mockResolvedValue([{ cnt: 0 }]);

      const res = await service.remove('tr-1');
      expect(transferRepo.remove).toHaveBeenCalledWith(tr);
      expect(intelligenceSync.syncApplicationById).toHaveBeenCalledWith('app-1');
      expect(res.success).toBe(true);
    });
  });

  describe('getStats', () => {
    it('computes UZS averages, channel breakdown, topProviders, and guards zero division', async () => {
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      const summaryQb = createMockQb({
        getRawOne: jest.fn().mockResolvedValue({
          total: '10',
          totalAmountUzs: '15000000',
          uzsCount: '3',
          successCount: '7',
          pendingCount: '2',
          cancelledCount: '1',
          cardToCardCount: '6',
          cryptoCount: '3',
          otherChannelCount: '1',
        }),
      });
      const provQb = createMockQb({
        getRawMany: jest.fn().mockResolvedValue([
          { id: 'p-1', name: 'Click', count: '4', totalAmount: '8000000' },
          { id: 'p-2', name: null, count: '2', totalAmount: '2000000' },
        ]),
      });
      transferRepo.createQueryBuilder.mockReturnValueOnce(summaryQb).mockReturnValueOnce(provQb);

      const stats = await service.getStats(OFFICER_USER);

      expect(stats).toEqual({
        total: 10,
        totalAmountUzs: 15000000,
        avgAmountUzs: 5000000,
        successCount: 7,
        pendingCount: 2,
        cancelledCount: 1,
        cardToCardCount: 6,
        cryptoCount: 3,
        otherChannelCount: 1,
        topProviders: [
          { id: 'p-1', name: 'Click', count: 4, totalAmount: 8000000, percent: 40 },
          { id: 'p-2', name: 'Noma‘lum tizim', count: 2, totalAmount: 2000000, percent: 20 },
        ],
      });
    });

    it('returns avgAmountUzs = 0 when uzsCount is 0 (only USD/empty transfers)', async () => {
      const summaryQb = createMockQb({
        getRawOne: jest.fn().mockResolvedValue({
          total: '2',
          totalAmountUzs: '0',
          uzsCount: '0',
        }),
      });
      const provQb = createMockQb({ getRawMany: jest.fn().mockResolvedValue([]) });
      transferRepo.createQueryBuilder.mockReturnValueOnce(summaryQb).mockReturnValueOnce(provQb);

      const stats = await service.getStats(ADMIN_USER);
      expect(stats.avgAmountUzs).toBe(0);
    });
  });
});
