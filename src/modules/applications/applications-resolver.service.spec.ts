import type { EntityManager, Repository } from 'typeorm';

import { CustomFieldType } from '../../common/enums/custom-field-type.enum';
import { Application } from './application.entity';
import { ApplicationsResolverService } from './applications-resolver.service';
import { Citizen } from './citizens/citizen.entity';
import { Crime } from './crimes/crime.entity';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { District } from './districts/district.entity';
import { Neighborhood } from './neighborhoods/neighborhood.entity';
import { ApplicationStatus } from './statuses/application-status.entity';
import { Bank } from './transfers/banks/bank.entity';
import { Card } from './transfers/cards/card.entity';
import { TransferCustomField } from './transfers/custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './transfers/payment_providers/payment_provider.entity';
import { Transfer } from './transfers/transfer.entity';
import type { WorkplacesService } from './workplaces/workplaces.service';

interface MockStore {
  transfers: Map<string, Partial<Transfer>>;
  cards: Map<string, Partial<Card>>;
  banks: Map<string, Partial<Bank>>;
  providers: Map<string, Partial<PaymentProvider>>;
  applications: Map<string, Partial<Application>>;
}

function createMockManager(store: MockStore): EntityManager {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const repos = new Map<unknown, Record<string, jest.Mock>>();

  repos.set(Transfer, {
    findOne: jest.fn(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where?.id ? (store.transfers.get(where.id) ?? null) : null),
    ),
    create: jest.fn((data: Partial<Transfer>) => ({ ...data })),
    save: jest.fn((entity: Partial<Transfer>) => {
      const id = entity.id || nextId('tr');
      const saved = { ...entity, id };
      store.transfers.set(id, saved);
      return Promise.resolve(saved);
    }),
    update: jest.fn((id: string, patch: Partial<Transfer>) => {
      const existing = store.transfers.get(id);
      if (existing) store.transfers.set(id, { ...existing, ...patch });
      return Promise.resolve({ affected: existing ? 1 : 0 });
    }),
  });

  repos.set(Card, {
    findOne: jest.fn(({ where }: { where: { id?: string; card_number?: string } }) => {
      if (where?.id) return Promise.resolve(store.cards.get(where.id) ?? null);
      if (where?.card_number) {
        for (const c of store.cards.values()) {
          if (c.card_number === where.card_number) return Promise.resolve(c);
        }
      }
      return Promise.resolve(null);
    }),
    create: jest.fn((data: Partial<Card>) => ({ ...data })),
    save: jest.fn((entity: Partial<Card>) => {
      const id = entity.id || nextId('card');
      const saved = { ...entity, id };
      store.cards.set(id, saved);
      return Promise.resolve(saved);
    }),
  });

  repos.set(Bank, {
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((data: Partial<Bank>) => ({ ...data })),
    save: jest.fn((entity: Partial<Bank>) => {
      const id = entity.id || nextId('bank');
      const saved = { ...entity, id };
      store.banks.set(id, saved);
      return Promise.resolve(saved);
    }),
  });

  repos.set(PaymentProvider, {
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((data: Partial<PaymentProvider>) => ({ ...data })),
    save: jest.fn((entity: Partial<PaymentProvider>) => {
      const id = entity.id || nextId('prov');
      const saved = { ...entity, id };
      store.providers.set(id, saved);
      return Promise.resolve(saved);
    }),
  });

  repos.set(Application, {
    findOne: jest.fn(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where?.id ? (store.applications.get(where.id) ?? null) : null),
    ),
  });

  const noopRepo = () => ({
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((data: Record<string, unknown>) => Promise.resolve(data)),
    update: jest.fn(() => Promise.resolve({ affected: 0 })),
  });

  for (const cls of [
    ApplicationCustomField,
    Citizen,
    Crime,
    District,
    Neighborhood,
    TransferCustomField,
    ApplicationStatus,
  ]) {
    repos.set(cls, noopRepo());
  }

  return {
    getRepository: jest.fn((entity: unknown) => repos.get(entity)),
  } as unknown as EntityManager;
}

describe('ApplicationsResolverService (multi-transfer create & edit)', () => {
  let service: ApplicationsResolverService;
  let store: MockStore;
  let manager: EntityManager;

  beforeEach(() => {
    store = {
      transfers: new Map(),
      cards: new Map(),
      banks: new Map(),
      providers: new Map(),
      applications: new Map(),
    };
    manager = createMockManager(store);
    const appRepo = { manager } as unknown as Repository<Application>;
    const workplacesService = { findOrCreate: jest.fn() } as unknown as WorkplacesService;
    service = new ApplicationsResolverService(appRepo, workplacesService);
  });

  it('updates existing extra transfers on edit when transfer_id is already set (fixes 0 UZS bug)', async () => {
    store.cards.set('card-victim', {
      id: 'card-victim',
      card_number: '4097830014808923',
    });
    store.transfers.set('tr-existing-3', {
      id: 'tr-existing-3',
      amount: null,
      currency: 'UZS',
      transfer_date: null,
      transfer_time: null,
      sender_card_id: 'card-victim',
      receiver_card_id: null,
      payment_provider_id: null,
      application_id: 'app-1',
    });
    store.transfers.set('tr-existing-4', {
      id: 'tr-existing-4',
      amount: null,
      currency: 'UZS',
      transfer_date: null,
      transfer_time: null,
      sender_card_id: null,
      receiver_card_id: null,
      payment_provider_id: null,
      application_id: 'app-1',
    });

    const fields = await service.processCustomFields(
      [
        {
          type: CustomFieldType.TRANSFER,
          label: "Qo'shimcha o'tkazma #3",
          key: 'transfer_3',
          card_id: 'card-victim',
          transfer_id: 'tr-existing-3',
          inline_transfer: {
            amount: '1 500 000',
            currency: 'UZS',
            transfer_date: '2026-11-22',
            transfer_time: '14:20',
            payment_provider_name: 'Click',
            receiver_card_number: '9860 1201 3456 7890',
            receiver_card_full_name: 'ALIYEV VALI',
          },
          order: 0,
        },
        {
          type: CustomFieldType.TRANSFER,
          label: "Qo'shimcha o'tkazma #4",
          key: 'transfer_4',
          card_id: 'card-victim',
          transfer_id: 'tr-existing-4',
          inline_transfer: {
            amount: 1420000,
            currency: 'UZS',
            transfer_date: '2026-11-23',
            transfer_time: '09:15',
          },
          order: 1,
        },
      ],
      'app-1',
      manager,
    );

    expect(fields).toHaveLength(2);
    expect(fields[0].transfer_id).toBe('tr-existing-3');
    expect(fields[1].transfer_id).toBe('tr-existing-4');

    const updated3 = store.transfers.get('tr-existing-3');
    expect(updated3?.amount).toBe(1500000);
    expect(updated3?.transfer_date).toBe('2026-11-22');
    expect(updated3?.transfer_time).toBe('14:20');
    expect(updated3?.payment_provider_id).toBeTruthy();
    expect(updated3?.receiver_card_id).toBeTruthy();

    const updated4 = store.transfers.get('tr-existing-4');
    expect(updated4?.amount).toBe(1420000);
    expect(updated4?.sender_card_id).toBe('card-victim');
    expect(updated4?.transfer_date).toBe('2026-11-23');
    expect(updated4?.transfer_time).toBe('09:15');
  });

  it('updates primary transfer amount, date, and receiver card on edit', async () => {
    store.cards.set('card-1', {
      id: 'card-1',
      card_number: '8600111122223333',
    });
    store.transfers.set('tr-primary', {
      id: 'tr-primary',
      amount: 100000,
      currency: 'UZS',
      transfer_date: '2026-11-20',
      transfer_time: null,
      sender_card_id: 'card-1',
      receiver_card_id: null,
      application_id: 'app-1',
    });
    store.applications.set('app-1', {
      id: 'app-1',
      card_id: 'card-1',
      transfer_id: 'tr-primary',
    });

    const resolved = await service.resolvePrimaryModels(
      {
        card_id: 'card-1',
        transfer_id: 'tr-primary',
        transfer_data: {
          amount: '2 750 000',
          currency: 'UZS',
          transfer_date: '2026-11-25',
          transfer_time: '18:05',
          receiver_card_number: '9860999988887777',
        },
      },
      'app-1',
      manager,
    );

    expect(resolved.transfer_id).toBe('tr-primary');
    const updatedPrimary = store.transfers.get('tr-primary');
    expect(updatedPrimary?.amount).toBe(2750000);
    expect(updatedPrimary?.transfer_date).toBe('2026-11-25');
    expect(updatedPrimary?.transfer_time).toBe('18:05');
    expect(updatedPrimary?.receiver_card_id).toBeTruthy();
  });
});
