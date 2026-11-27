import type { Repository } from 'typeorm';

import type { Application } from '../applications/application.entity';
import type { Citizen } from '../applications/citizens/citizen.entity';
import type { SuspectFieldConfig } from '../applications/suspect-fields/suspect-field-config.entity';
import type { Bank } from '../applications/transfers/banks/bank.entity';
import type { Card } from '../applications/transfers/cards/card.entity';
import type { Transfer } from '../applications/transfers/transfer.entity';
import type { DigitalIdentifierEntity } from './entities/digital-identifier.entity';
import { EntityApplicationLink } from './entities/entity-application-link.entity';
import type { PhoneEntity } from './entities/phone.entity';
import { IntelligenceSyncService } from './intelligence-sync.service';

function createSyncTestHarness() {
  const deleteMock = jest.fn().mockResolvedValue(undefined);
  const executeMock = jest.fn().mockResolvedValue(undefined);
  const orIgnoreMock = jest.fn().mockReturnValue({ execute: executeMock });
  const valuesMock = jest.fn().mockReturnValue({ orIgnore: orIgnoreMock });
  const intoMock = jest.fn().mockReturnValue({ values: valuesMock });
  const insertMock = jest.fn().mockReturnValue({ into: intoMock });
  const txManager = {
    delete: deleteMock,
    createQueryBuilder: jest.fn().mockReturnValue({ insert: insertMock }),
  };

  const linkRepo = {
    delete: jest.fn(),
    manager: {
      transaction: jest.fn(async (cb: (m: typeof txManager) => Promise<void>) => cb(txManager)),
    },
  } as unknown as Repository<EntityApplicationLink>;

  const phonesStore: PhoneEntity[] = [];
  const phoneRepo = {
    findOne: jest.fn(({ where }: { where: { phone_number: string } }) =>
      Promise.resolve(phonesStore.find((p) => p.phone_number === where.phone_number) || null),
    ),
    create: jest.fn((data: Partial<PhoneEntity>) => ({
      id: `phone-${phonesStore.length + 1}`,
      ...data,
    })),
    save: jest.fn((entity: PhoneEntity) => {
      phonesStore.push(entity);
      return Promise.resolve(entity);
    }),
  } as unknown as Repository<PhoneEntity>;

  const identStore: DigitalIdentifierEntity[] = [];
  const identifierRepo = {
    findOne: jest.fn(({ where }: { where: { type: string; normalized_value: string } }) =>
      Promise.resolve(
        identStore.find(
          (i) => i.type === where.type && i.normalized_value === where.normalized_value,
        ) || null,
      ),
    ),
    create: jest.fn((data: Partial<DigitalIdentifierEntity>) => ({
      id: `ident-${identStore.length + 1}`,
      ...data,
    })),
    save: jest.fn((entity: DigitalIdentifierEntity) => {
      identStore.push(entity);
      return Promise.resolve(entity);
    }),
  } as unknown as Repository<DigitalIdentifierEntity>;

  return {
    deleteMock,
    executeMock,
    orIgnoreMock,
    valuesMock,
    linkRepo,
    phoneRepo,
    identifierRepo,
    phonesStore,
    identStore,
  };
}

describe('IntelligenceSyncService', () => {
  it('syncs application links atomically with ON CONFLICT DO NOTHING preserving manual links', async () => {
    const h = createSyncTestHarness();

    const appRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'app-1',
        is_deleted: false,
        citizen_id: 'cit-1',
        citizen: { id: 'cit-1', phone_number: null },
        card: { id: 'card-1', citizen_id: 'cit-1' },
        transfer: {
          id: 'tr-1',
          sender_card: { id: 'card-1', citizen_id: 'cit-1' },
          receiver_card: { id: 'card-2', citizen_id: null },
          receiver_identifier: { id: 'ident-1', citizen_id: null },
          destination_label: 'USDT wallet',
        },
        custom_fields: [],
        suspect_tree: [],
      }),
    } as unknown as Repository<Application>;

    const transferRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<Transfer>;

    const service = new IntelligenceSyncService(
      h.phoneRepo,
      h.identifierRepo,
      h.linkRepo,
      {} as Repository<Citizen>,
      {} as Repository<Card>,
      {} as Repository<Bank>,
      appRepo,
      transferRepo,
    );

    await service.syncApplicationById('app-1');

    expect(h.deleteMock).toHaveBeenCalledWith(EntityApplicationLink, {
      application_id: 'app-1',
      source: 'AUTO_SYNC',
    });
    expect(h.orIgnoreMock).toHaveBeenCalled();
    expect(h.executeMock).toHaveBeenCalled();
    const firstCallArgs = h.valuesMock.mock.calls[0] as [Array<Record<string, unknown>>];
    const insertedValues = firstCallArgs[0];
    expect(insertedValues.some((v) => v.identifier_id === 'ident-1' && v.role === 'DROPPER')).toBe(
      true,
    );
  });

  it('skips non-linkable suspect fields (telegram_bio, other_info, and DB is_linkable=false) during sync', async () => {
    const h = createSyncTestHarness();

    const appRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'app-2',
        is_deleted: false,
        citizen_id: 'cit-1',
        citizen: { id: 'cit-1', phone_number: null },
        card: null,
        transfer: null,
        custom_fields: [],
        suspect_tree: [
          { field_key: 'telegram_bio', field_label: 'Telegram Bio', value: 'Online savdo 24/7' },
          { field_key: 'other_info', field_label: 'Boshqa izoh', value: 'Telefon qilib aldadi' },
          { field_key: 'custom_note', field_label: 'Maxsus izoh', value: 'Oddiy matn izoh' },
          {
            field_key: 'telegram_username',
            field_label: 'Telegram Username',
            value: 'https://t.me/Scam_Bot',
          },
        ],
      }),
    } as unknown as Repository<Application>;

    const transferRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<Transfer>;

    const suspectFieldRepo = {
      find: jest.fn().mockResolvedValue([
        { key: 'telegram_bio', is_linkable: false },
        { key: 'other_info', is_linkable: false },
        { key: 'custom_note', is_linkable: false },
      ]),
    } as unknown as Repository<SuspectFieldConfig>;

    const service = new IntelligenceSyncService(
      h.phoneRepo,
      h.identifierRepo,
      h.linkRepo,
      {} as Repository<Citizen>,
      {} as Repository<Card>,
      {} as Repository<Bank>,
      appRepo,
      transferRepo,
      suspectFieldRepo,
    );

    await service.syncApplicationById('app-2');

    // Only telegram_username should be created as a digital identifier
    expect(h.identStore).toHaveLength(1);
    expect(h.identStore[0].type).toBe('telegram_username');
    expect(h.identStore[0].normalized_value).toBe('scam_bot');

    const insertedValues = (h.valuesMock.mock.calls[0] as [Array<Record<string, unknown>>])[0];
    const identifierLinks = insertedValues.filter((v) => v.identifier_id);
    expect(identifierLinks).toHaveLength(1);
    expect(identifierLinks[0].role).toBe('SUSPECT');
  });

  it('normalizes whatsapp_number to 998 phone record with SUSPECT role and respects explicit entity_role / Cyrillic labels', async () => {
    const h = createSyncTestHarness();

    const appRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'app-3',
        is_deleted: false,
        citizen_id: 'cit-victim',
        citizen: { id: 'cit-victim', phone_number: null },
        card: null,
        transfer: null,
        custom_fields: [
          {
            type: 'CITIZEN',
            label: 'Qo‘shimcha shaxs',
            entity_role: 'DROPPER',
            citizen_id: 'cit-dropper',
            citizen: { id: 'cit-dropper', phone_number: '+998 90 111-22-33' },
          },
          {
            type: 'CITIZEN',
            label: 'Гумонланувчи (Шерик)',
            entity_role: null,
            citizen_id: 'cit-cyrillic-suspect',
            citizen: { id: 'cit-cyrillic-suspect', phone_number: null },
          },
        ],
        suspect_tree: [
          {
            field_key: 'whatsapp_number',
            field_label: 'WhatsApp raqami',
            value: '+998 (99) 555-66-77',
          },
        ],
      }),
    } as unknown as Repository<Application>;

    const transferRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<Transfer>;

    const service = new IntelligenceSyncService(
      h.phoneRepo,
      h.identifierRepo,
      h.linkRepo,
      {} as Repository<Citizen>,
      {} as Repository<Card>,
      {} as Repository<Bank>,
      appRepo,
      transferRepo,
    );

    await service.syncApplicationById('app-3');

    const insertedValues = (h.valuesMock.mock.calls[0] as [Array<Record<string, unknown>>])[0];

    // WhatsApp number routed to phones table as 998995556677 with SUSPECT role
    const waPhone = h.phonesStore.find((p) => p.phone_number === '998995556677');
    expect(waPhone).toBeDefined();
    expect(insertedValues.some((v) => v.phone_id === waPhone?.id && v.role === 'SUSPECT')).toBe(
      true,
    );

    // Explicit entity_role = DROPPER preserved
    expect(
      insertedValues.some(
        (v) => v.citizen_id === 'cit-dropper' && v.role === 'DROPPER' && !v.phone_id,
      ),
    ).toBe(true);

    // Cyrillic label 'Гумонланувчи (Шерик)' inferred as SUSPECT
    expect(
      insertedValues.some(
        (v) => v.citizen_id === 'cit-cyrillic-suspect' && v.role === 'SUSPECT' && !v.phone_id,
      ),
    ).toBe(true);
  });
});
