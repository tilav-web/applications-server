import type { Repository } from 'typeorm';

import type { Application } from '../applications/application.entity';
import type { Citizen } from '../applications/citizens/citizen.entity';
import type { Bank } from '../applications/transfers/banks/bank.entity';
import type { Card } from '../applications/transfers/cards/card.entity';
import type { Transfer } from '../applications/transfers/transfer.entity';
import type { DigitalIdentifierEntity } from './entities/digital-identifier.entity';
import { EntityApplicationLink } from './entities/entity-application-link.entity';
import type { PhoneEntity } from './entities/phone.entity';
import { IntelligenceSyncService } from './intelligence-sync.service';

describe('IntelligenceSyncService', () => {
  it('syncs application links atomically with ON CONFLICT DO NOTHING preserving manual links', async () => {
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
      {} as Repository<PhoneEntity>,
      {} as Repository<DigitalIdentifierEntity>,
      linkRepo,
      {} as Repository<Citizen>,
      {} as Repository<Card>,
      {} as Repository<Bank>,
      appRepo,
      transferRepo,
    );

    await service.syncApplicationById('app-1');

    expect(deleteMock).toHaveBeenCalledWith(EntityApplicationLink, {
      application_id: 'app-1',
      source: 'AUTO_SYNC',
    });
    expect(orIgnoreMock).toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalled();
    const firstCallArgs = valuesMock.mock.calls[0] as [Array<Record<string, unknown>>];
    const insertedValues = firstCallArgs[0];
    expect(insertedValues.some((v) => v.identifier_id === 'ident-1' && v.role === 'DROPPER')).toBe(
      true,
    );
  });
});
