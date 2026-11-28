import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import type { Application } from '../applications/application.entity';
import type { Citizen } from '../applications/citizens/citizen.entity';
import type { Bank } from '../applications/transfers/banks/bank.entity';
import type { Card } from '../applications/transfers/cards/card.entity';
import type { PaymentProvider } from '../applications/transfers/payment_providers/payment_provider.entity';
import type { Transfer } from '../applications/transfers/transfer.entity';
import type { FinancialFlowService } from '../financial-flow/financial-flow.service';
import type { User } from '../users/user.entity';
import type { DigitalIdentifierEntity } from './entities/digital-identifier.entity';
import type { EntityApplicationLink } from './entities/entity-application-link.entity';
import type { PhoneEntity } from './entities/phone.entity';
import { IntelligenceService } from './intelligence.service';
import type { DossierApplicationItem, DossierTransferItem } from './intelligence.types';
import type { IntelligenceSyncService } from './intelligence-sync.service';

interface MockQb {
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
}

function createMockQb(items: unknown[] = []): MockQb {
  const qb: MockQb = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn().mockResolvedValue(items),
  };
  for (const k of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take'] as const) {
    qb[k].mockReturnValue(qb);
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

describe('IntelligenceService', () => {
  let service: IntelligenceService;
  let phoneRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let identifierRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let linkRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let citizenRepo: { findOne: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let cardRepo: { findOne: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let bankRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let providerRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let transferRepo: { create: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let appRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let syncService: {
    upsertPhone: jest.Mock;
    upsertCard: jest.Mock;
    upsertDigitalIdentifier: jest.Mock;
    syncApplicationById: jest.Mock;
    syncApplicationsByCardId: jest.Mock;
    syncApplicationsByPhoneId: jest.Mock;
    syncApplicationsByIdentifierId: jest.Mock;
  };
  let financialFlowService: { identifyBank: jest.Mock };

  beforeEach(() => {
    phoneRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve(e)),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => createMockQb()),
    };
    identifierRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve(e)),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => createMockQb()),
    };
    linkRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      update: jest.fn().mockResolvedValue(undefined),
    };
    citizenRepo = {
      findOne: jest.fn(),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve(e)),
      createQueryBuilder: jest.fn(() => createMockQb()),
    };
    cardRepo = {
      findOne: jest.fn(),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve(e)),
      createQueryBuilder: jest.fn(() => createMockQb()),
    };
    bankRepo = {
      findOne: jest.fn(),
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve({ id: 'bank-1', ...e })),
    };
    providerRepo = {
      findOne: jest.fn(),
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve({ id: 'prov-1', ...e })),
    };
    transferRepo = {
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn((e: Record<string, unknown>) => Promise.resolve({ id: 'tr-1', ...e })),
      createQueryBuilder: jest.fn(() => createMockQb()),
    };
    appRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => createMockQb()),
    };
    userRepo = { findOne: jest.fn().mockResolvedValue(null) };
    syncService = {
      upsertPhone: jest.fn(),
      upsertCard: jest.fn(),
      upsertDigitalIdentifier: jest.fn(),
      syncApplicationById: jest.fn().mockResolvedValue(undefined),
      syncApplicationsByCardId: jest.fn().mockResolvedValue(undefined),
      syncApplicationsByPhoneId: jest.fn().mockResolvedValue(undefined),
      syncApplicationsByIdentifierId: jest.fn().mockResolvedValue(undefined),
    };
    financialFlowService = { identifyBank: jest.fn().mockReturnValue('Agrobank') };

    service = new IntelligenceService(
      phoneRepo as unknown as Repository<PhoneEntity>,
      identifierRepo as unknown as Repository<DigitalIdentifierEntity>,
      linkRepo as unknown as Repository<EntityApplicationLink>,
      citizenRepo as unknown as Repository<Citizen>,
      cardRepo as unknown as Repository<Card>,
      bankRepo as unknown as Repository<Bank>,
      providerRepo as unknown as Repository<PaymentProvider>,
      transferRepo as unknown as Repository<Transfer>,
      appRepo as unknown as Repository<Application>,
      userRepo as unknown as Repository<User>,
      syncService as unknown as IntelligenceSyncService,
      financialFlowService as unknown as FinancialFlowService,
    );
  });

  describe('globalSearch', () => {
    it('returns empty immediately for blank query or DISTRICT_OFFICER with no assigned districts', async () => {
      const emptyRes = await service.globalSearch('   ', undefined, 20, ADMIN_USER);
      expect(emptyRes.totalCount).toBe(0);
      expect(citizenRepo.createQueryBuilder).not.toHaveBeenCalled();

      userRepo.findOne.mockResolvedValue({ assigned_districts: [] });
      const officerRes = await service.globalSearch('86001234', undefined, 20, OFFICER_USER);
      expect(officerRes.totalCount).toBe(0);
      expect(citizenRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('escapes LIKE wildcards across queries, strips t.me/ handles, and filters by category', async () => {
      const identQb = createMockQb([
        {
          id: 'id-1',
          type: 'telegram_username',
          type_label: 'Telegram',
          raw_value: '@scam_100%',
          normalized_value: 'scam_100%',
        },
      ]);
      identifierRepo.createQueryBuilder.mockReturnValue(identQb);

      const res = await service.globalSearch('t.me/@scam_100%', 'identifiers', 25, ADMIN_USER);

      expect(identQb.where).toHaveBeenCalledWith(expect.stringContaining('ILIKE :handleQ'), {
        ilikeQ: '%t.me/@scam\\_100\\%%',
        handleQ: '%scam\\_100\\%%',
      });
      expect(res.items).toHaveLength(1);
      expect(res.items[0].category).toBe('identifiers');
      expect(res.items[0].targetRoute).toBe('/dossier/identifier/id-1');
    });
  });

  describe('checkRadar', () => {
    it('ignores short values (< 3 chars) and non-linkable types (telegram_bio, other_info)', async () => {
      const short = await service.checkRadar('card_number', '86', undefined, ADMIN_USER);
      expect(short.found).toBe(false);

      const bio = await service.checkRadar(
        'telegram_bio',
        'Assalomu alaykum',
        undefined,
        ADMIN_USER,
      );
      expect(bio.found).toBe(false);
      expect(identifierRepo.findOne).not.toHaveBeenCalled();
    });

    it('normalizes hyphenated passport strings to match stored citizens and masks cross-district apps for DISTRICT_OFFICER', async () => {
      citizenRepo.findOne.mockResolvedValue({
        id: 'cit-1',
        full_name: 'Firibgar Shaxs',
        passport: 'AB1234567',
        phone_number: '998901234567',
      });
      linkRepo.find.mockResolvedValue([
        {
          application_id: 'app-1',
          role: 'SUSPECT',
          application: {
            id: 'app-1',
            application_number: '2026-00001',
            district_id: 'dist-1',
            is_deleted: false,
            date: new Date('2026-11-20'),
            created_at: new Date('2026-11-20'),
            transfer: { amount: 2000000, currency: 'UZS' },
          },
        },
        {
          application_id: 'app-2',
          role: 'DROPPER',
          application: {
            id: 'app-2',
            application_number: '2026-99999',
            district_id: 'dist-other',
            is_deleted: false,
            date: new Date('2026-11-21'),
            created_at: new Date('2026-11-21'),
            transfer: { amount: 3000000, currency: 'UZS' },
          },
        },
        {
          // Deleted app must be excluded
          application_id: 'app-del',
          role: 'SUSPECT',
          application: { id: 'app-del', is_deleted: true },
        },
        {
          // Excluded current app must be ignored
          application_id: 'app-current',
          role: 'SUSPECT',
          application: { id: 'app-current', is_deleted: false },
        },
      ]);
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });

      const res = await service.checkRadar(
        'passport',
        'ab - 123-4567',
        'app-current',
        OFFICER_USER,
      );

      expect(citizenRepo.findOne).toHaveBeenCalledWith({ where: { passport: 'AB1234567' } });
      expect(res.found).toBe(true);
      expect(res.appsCount).toBe(2);
      expect(res.suspectCount).toBe(2);
      expect(res.totalLoss).toBe(5000000);
      expect(res.riskLevel).toBe('CRITICAL');
      expect(res.recentApplications.find((a) => a.id === 'app-1')?.application_number).toBe(
        '2026-00001',
      );
      expect(res.recentApplications.find((a) => a.id === 'app-2')?.application_number).toBe(
        'Boshqa tuman (yopiq)',
      );
    });
  });

  describe('entity ownership mutations & RBAC', () => {
    it('blocks BOSS role from all intelligence mutations', async () => {
      await expect(
        service.addPhoneToCitizen('cit-1', { phone_number: '901234567' }, BOSS_USER),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.removePhoneFromCitizen('ph-1', BOSS_USER)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.bindEntityToCitizen(
          { entity_type: 'card', entity_id: 'c1', citizen_id: 'cit-1' },
          BOSS_USER,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.linkCitizenRoleToApplication(
          { application_id: 'a1', citizen_id: 'c1', role: 'SUSPECT' },
          BOSS_USER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks non-admin from reassigning a phone/card already owned by another citizen (409), while allowing ADMIN', async () => {
      citizenRepo.findOne.mockResolvedValue({ id: 'cit-2', full_name: 'Target' });
      phoneRepo.findOne.mockResolvedValue({ id: 'ph-1', citizen_id: 'cit-1' });

      await expect(
        service.addPhoneToCitizen('cit-2', { phone_number: '90 123 45 67' }, STAFF_USER),
      ).rejects.toThrow(ConflictException);

      // ADMIN can reassign and batch-links unowned app links in ONE save call
      syncService.upsertPhone.mockResolvedValue({
        id: 'ph-1',
        phone_number: '998901234567',
        citizen_id: 'cit-1',
      });
      linkRepo.find.mockResolvedValue([
        { id: 'l1', citizen_id: null },
        { id: 'l2', citizen_id: null },
        { id: 'l3', citizen_id: 'cit-already' },
      ]);

      const res = await service.addPhoneToCitizen(
        'cit-2',
        { phone_number: '90 123 45 67' },
        ADMIN_USER,
      );
      expect(res.newlyLinkedAppsCount).toBe(2);
      expect(linkRepo.save).toHaveBeenCalledTimes(1);
    });

    it('unlinks phone/identifier instead of deleting when linked to applications, and hard-deletes when unlinked', async () => {
      const ph = { id: 'ph-1', citizen_id: 'cit-1', is_primary: true };
      phoneRepo.findOne.mockResolvedValue(ph);
      linkRepo.count.mockResolvedValueOnce(3);

      await service.removePhoneFromCitizen('ph-1', ADMIN_USER);
      expect(phoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ citizen_id: null, is_primary: false }),
      );
      expect(phoneRepo.remove).not.toHaveBeenCalled();

      linkRepo.count.mockResolvedValueOnce(0);
      await service.removePhoneFromCitizen('ph-1', ADMIN_USER);
      expect(phoneRepo.remove).toHaveBeenCalledWith(ph);
    });

    it('enforces application existence and DISTRICT_OFFICER district scope in linkCitizenRoleToApplication', async () => {
      appRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.linkCitizenRoleToApplication(
          { application_id: 'missing', citizen_id: 'cit-1', role: 'SUSPECT' },
          ADMIN_USER,
        ),
      ).rejects.toThrow(NotFoundException);

      appRepo.findOne.mockResolvedValueOnce({ id: 'app-other', district_id: 'dist-2' });
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      await expect(
        service.linkCitizenRoleToApplication(
          { application_id: 'app-other', citizen_id: 'cit-1', role: 'SUSPECT' },
          OFFICER_USER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createTransitTransfer', () => {
    it('rejects negative amount, self-transfer (same sender/receiver card), and missing endpoints', async () => {
      await expect(
        service.createTransitTransfer(
          { sender_card_id: 'c1', receiver_card_id: 'c2', amount: -500 },
          ADMIN_USER,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createTransitTransfer(
          { sender_card_id: 'c1', receiver_card_id: 'c1', amount: 100000 },
          ADMIN_USER,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(service.createTransitTransfer({ amount: 100000 }, ADMIN_USER)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates CRYPTO -> CARD transit transfer, recovers from bank 23505 race, and maps duplicate transaction_id to ConflictException', async () => {
      syncService.upsertDigitalIdentifier.mockResolvedValue({ id: 'ident-src' });
      bankRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'bank-race' });
      bankRepo.save.mockRejectedValueOnce({ code: '23505' });
      syncService.upsertCard.mockResolvedValue({ id: 'card-dst' });

      await service.createTransitTransfer(
        {
          source_type: TransferDestinationType.CRYPTO,
          source_platform: 'Binance',
          source_network: 'TRC20',
          source_value: 'TXYZ999',
          destination_type: TransferDestinationType.CARD,
          receiver_card_number: '8600 1111 2222 3333',
          receiver_bank_name: 'Agrobank',
          amount: 4500000,
          application_id: 'app-1',
        },
        ADMIN_USER,
      );

      const createCalls = transferRepo.create.mock.calls as Array<[Record<string, unknown>]>;
      const createdTransfer = createCalls[0][0];
      expect(createdTransfer.sender_card_id).toBeNull();
      expect(createdTransfer.receiver_card_id).toBe('card-dst');
      expect(createdTransfer.amount).toBe(4500000);
      expect(createdTransfer.destination_details).toMatchObject({
        source_type: TransferDestinationType.CRYPTO,
        source_identifier_id: 'ident-src',
      });
      expect(syncService.syncApplicationById).toHaveBeenCalledWith('app-1');

      // Duplicate transaction_id -> 409 ConflictException
      transferRepo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      await expect(
        service.createTransitTransfer(
          {
            sender_card_id: 'c1',
            receiver_card_id: 'c2',
            amount: 1000,
            transaction_id: 'DUP-1',
          },
          ADMIN_USER,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('buildMicroStats (risk scoring, TRANSIT role & cross-role collision)', () => {
    it('counts TRANSIT role in suspectOrDropperAppsCount, flags cross-role collision, and buckets hourly volume', () => {
      const apps: DossierApplicationItem[] = [
        {
          id: 'a1',
          application_number: '2026-1',
          description: null,
          officer_notes: null,
          status: 'YANGI',
          status_label: 'Yangi',
          status_color: 'blue',
          date: '2026-11-10T00:00:00.000Z',
          district_id: 'd1',
          district_name: 'Qarshi sh.',
          crime_article: '168-modda',
          crime_method: null,
          victim_name: null,
          victim_phone: null,
          role_in_app: 'VICTIM',
          link_source: 'AUTO_SYNC',
          match_reasons: [],
          transfer_amount: 1000000,
          currency: 'UZS',
          payment_provider: 'Click',
          can_edit: true,
        },
        {
          id: 'a2',
          application_number: '2026-2',
          description: null,
          officer_notes: null,
          status: 'JARAYONDA',
          status_label: 'Jarayonda',
          status_color: 'amber',
          date: '2026-11-20T00:00:00.000Z',
          district_id: 'd1',
          district_name: 'Qarshi sh.',
          crime_article: '168-modda',
          crime_method: null,
          victim_name: null,
          victim_phone: null,
          role_in_app: 'TRANSIT',
          link_source: 'AUTO_SYNC',
          match_reasons: [],
          transfer_amount: 2000000,
          currency: 'UZS',
          payment_provider: 'Payme',
          can_edit: true,
        },
      ];
      const transfers: DossierTransferItem[] = [
        {
          id: 't1',
          transaction_id: 'T1',
          direction: 'INCOMING',
          amount: 2000000,
          currency: 'UZS',
          transfer_date: '2026-11-20',
          transfer_time: '14:15',
          payment_provider: 'Payme',
          sender_card_id: 'c1',
          sender_card_number: null,
          sender_owner_name: null,
          receiver_card_id: 'c2',
          receiver_card_number: null,
          receiver_owner_name: null,
          application_id: 'a2',
          application_number: '2026-2',
          images: [],
        },
      ];

      const stats = (
        service as unknown as {
          buildMicroStats: (
            a: DossierApplicationItem[],
            t: DossierTransferItem[],
          ) => ReturnType<IntelligenceService['getCitizenDossier']> extends Promise<infer R>
            ? R extends { stats: infer S }
              ? S
              : never
            : never;
        }
      ).buildMicroStats(apps, transfers);

      expect(stats.victimAppsCount).toBe(1);
      expect(stats.suspectOrDropperAppsCount).toBe(1); // TRANSIT counted!
      expect(stats.isCrossRoleCollision).toBe(true);
      expect(stats.riskScore).toBe(85); // 65 + 1*10 + 10 (cross-role)
      expect(stats.riskLevel).toBe('CRITICAL');
      expect(stats.hourlyDistribution[3].count).toBe(1); // 12:00–16:00 slot
      expect(stats.activeSpanDays).toBe(10);
    });
  });
});
