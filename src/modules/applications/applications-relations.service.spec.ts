import type { Repository } from 'typeorm';

import { ApplicationRepeatType } from '../../common/enums/appeal-classification.enum';
import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import type { IntelligenceService } from '../intelligence/intelligence.service';
import type { User } from '../users/user.entity';
import type { Application } from './application.entity';
import { ApplicationsRelationsService } from './applications-relations.service';
import type { Transfer } from './transfers/transfer.entity';

function buildBaseApp(overrides: Partial<Application> & { id: string }): Application {
  return {
    application_number: `APP-${overrides.id}`,
    description: null,
    status: 'YANGI',
    application_status: { id: 'st-1', name: 'Yangi', color: 'blue' } as never,
    date: new Date('2026-05-01T10:00:00Z'),
    repeat_type: ApplicationRepeatType.PRIMARY,
    root_application_id: null,
    is_deleted: false,
    citizen_id: null,
    citizen: null,
    district_id: 'dist-1',
    district: { id: 'dist-1', name: 'Qarshi sh.' } as never,
    crime: { id: 'cr-1', article: '168-modda' } as never,
    card_id: null,
    card: null,
    transfer_id: null,
    transfer: null,
    damages: [],
    custom_fields: [],
    suspect_tree: [],
    ...overrides,
  } as Application;
}

function createRelationsServiceHarness(opts: {
  candidateApps: Application[];
  extraTransfersByAppId?: Record<string, Transfer[]>;
  repeatAppsForCitizen?: Application[];
}) {
  const managerQueryMock = jest.fn().mockImplementation((sql: string) => {
    if (sql.includes('SELECT DISTINCT a2.id AS app_id')) {
      return Promise.resolve(opts.candidateApps.map((a) => ({ app_id: a.id })));
    }
    return Promise.resolve([]);
  });

  const appRepo = {
    manager: { query: managerQueryMock },
    find: jest.fn().mockImplementation((options?: { where?: Record<string, unknown> }) => {
      if (options?.where && 'citizen_id' in options.where) {
        return Promise.resolve(opts.repeatAppsForCitizen || []);
      }
      return Promise.resolve(opts.candidateApps);
    }),
  } as unknown as Repository<Application>;

  const transferRepo = {
    find: jest.fn().mockImplementation((options?: { where?: { application_id?: unknown } }) => {
      const appIdFilter = options?.where?.application_id;
      if (typeof appIdFilter === 'string') {
        return Promise.resolve(opts.extraTransfersByAppId?.[appIdFilter] || []);
      }
      const all: Transfer[] = [];
      for (const a of opts.candidateApps) {
        all.push(...(opts.extraTransfersByAppId?.[a.id] || []));
      }
      return Promise.resolve(all);
    }),
  } as unknown as Repository<Transfer>;

  const userRepo = {
    findOne: jest.fn().mockResolvedValue(null),
  } as unknown as Repository<User>;

  const intelligenceService = {
    getEnhancedApplicationIntelligence: jest.fn().mockResolvedValue({
      clue_relations: [],
      multi_hop_chains: [],
      probable_matches: [],
      detected_crime_relations: [],
      network_graph: { nodes: [], edges: [] },
    }),
  } as unknown as IntelligenceService;

  const service = new ApplicationsRelationsService(
    appRepo,
    transferRepo,
    userRepo,
    intelligenceService,
  );

  return { service, managerQueryMock, appRepo, transferRepo, intelligenceService };
}

describe('ApplicationsRelationsService (Fraudster-Centric Relations)', () => {
  it('produces ZERO fraudster relations when the same VICTIM submits 2 apps with same phone and sender card, separating them into applicant_repeat_applications', async () => {
    const victim = {
      id: 'cit-victim-1',
      full_name: 'Karimov Ali',
      phone_number: '+998901234567',
      passport: 'AA1234567',
      pinfl: '30101901234567',
    };
    const victimCard = {
      id: 'card-victim-1',
      card_number: '8600123412341234',
      masked_number: '8600 **** **** 1234',
      citizen_id: victim.id,
      citizen: victim,
    };

    const app1 = buildBaseApp({
      id: 'app-1',
      citizen_id: victim.id,
      citizen: victim as never,
      card_id: victimCard.id,
      card: victimCard as never,
      transfer: {
        id: 'tr-1',
        application_id: 'app-1',
        amount: 2_000_000,
        currency: 'UZS',
        sender_card_id: victimCard.id,
        sender_card: victimCard as never,
        receiver_card_id: 'card-drop-a',
        receiver_card: { id: 'card-drop-a', card_number: '9860111122223333' } as never,
      } as never,
    });

    const app2 = buildBaseApp({
      id: 'app-2',
      citizen_id: victim.id,
      citizen: victim as never,
      card_id: victimCard.id,
      card: victimCard as never,
      transfer: {
        id: 'tr-2',
        application_id: 'app-2',
        amount: 3_000_000,
        currency: 'UZS',
        sender_card_id: victimCard.id,
        sender_card: victimCard as never,
        receiver_card_id: 'card-drop-b',
        receiver_card: { id: 'card-drop-b', card_number: '9860999988887777' } as never,
      } as never,
    });

    const { service } = createRelationsServiceHarness({
      candidateApps: [app2],
      repeatAppsForCitizen: [app1, app2],
    });

    const result = await service.getRelations(app1);

    expect(result.stats.total_linked_applications).toBe(0);
    expect(result.stats.has_fraud_card_link).toBe(false);
    expect(result.stats.has_cross_role_collision).toBe(false);
    expect(result.linked_applications).toHaveLength(0);
    expect(result.card_relations).toHaveLength(0);
    expect(result.citizen_relations).toHaveLength(0);
    expect(result.applicant_repeat_applications).toHaveLength(1);
    expect(result.applicant_repeat_applications[0].id).toBe('app-2');
  });

  it('links two different victims who transferred funds to the same DROPPER receiver card', async () => {
    const dropperCard = {
      id: 'card-dropper-1',
      card_number: '9860030111112222',
      masked_number: '9860 **** **** 2222',
      full_name: 'DROPPER SHAXS',
    };

    const app1 = buildBaseApp({
      id: 'app-1',
      citizen_id: 'cit-v1',
      citizen: {
        id: 'cit-v1',
        full_name: 'Jabrlanuvchi 1',
        phone_number: '+998901111111',
      } as never,
      transfer: {
        id: 'tr-1',
        application_id: 'app-1',
        amount: 5_000_000,
        currency: 'UZS',
        sender_card: { id: 'card-v1', card_number: '8600000000000001' } as never,
        receiver_card_id: dropperCard.id,
        receiver_card: dropperCard as never,
      } as never,
    });

    const app2 = buildBaseApp({
      id: 'app-2',
      citizen_id: 'cit-v2',
      citizen: {
        id: 'cit-v2',
        full_name: 'Jabrlanuvchi 2',
        phone_number: '+998902222222',
      } as never,
      transfer: {
        id: 'tr-2',
        application_id: 'app-2',
        amount: 7_500_000,
        currency: 'UZS',
        sender_card: { id: 'card-v2', card_number: '8600000000000002' } as never,
        receiver_card_id: dropperCard.id,
        receiver_card: dropperCard as never,
      } as never,
    });

    const { service } = createRelationsServiceHarness({
      candidateApps: [app2],
    });

    const result = await service.getRelations(app1);

    expect(result.stats.total_linked_applications).toBe(1);
    expect(result.stats.has_fraud_card_link).toBe(true);
    expect(result.stats.has_cross_role_collision).toBe(false);
    expect(result.stats.total_linked_loss).toBe(7_500_000);
    expect(result.stats.grand_total_loss).toBe(12_500_000);
    expect(result.card_relations).toHaveLength(1);
    expect(result.card_relations[0].role_in_current_app).toBe('RECEIVER');
    expect(result.linked_applications).toHaveLength(1);
    expect(result.linked_applications[0].id).toBe('app-2');
    expect(result.linked_applications[0].match_reasons[0].kind).toBe('CARD');
  });

  it('detects dropper card matches on the 2nd transfer of a multi-transfer application and builds non-card crypto graph nodes', async () => {
    const sharedDropperCard = {
      id: 'card-drop-2',
      card_number: '9860030199998888',
      masked_number: '9860 **** **** 8888',
    };

    const tr1 = {
      id: 'tr-1a',
      application_id: 'app-multi',
      amount: 1_000_000,
      currency: 'UZS',
      destination_type: TransferDestinationType.CRYPTO,
      destination_label: 'Binance · UID 445566',
      destination_details: { platform: 'Binance', value: 'UID 445566' },
      sender_card: { id: 'card-v-multi', card_number: '8600111100001111' } as never,
      receiver_card: null,
      receiver_identifier: {
        id: 'ident-binance',
        type: 'crypto_wallet',
        type_label: 'Kripto-hamyon',
        raw_value: 'UID 445566',
      } as never,
    } as unknown as Transfer;

    const tr2 = {
      id: 'tr-1b',
      application_id: 'app-multi',
      amount: 4_000_000,
      currency: 'UZS',
      destination_type: TransferDestinationType.CARD,
      sender_card: { id: 'card-v-multi', card_number: '8600111100001111' } as never,
      receiver_card_id: sharedDropperCard.id,
      receiver_card: sharedDropperCard as never,
    } as unknown as Transfer;

    const appMulti = buildBaseApp({
      id: 'app-multi',
      citizen_id: 'cit-vm',
      citizen: { id: 'cit-vm', full_name: 'Ko‘p o‘tkazmali jabrlanuvchi' } as never,
      transfer: tr1,
    });

    const otherApp = buildBaseApp({
      id: 'app-other',
      citizen_id: 'cit-vo',
      citizen: { id: 'cit-vo', full_name: 'Boshqa jabrlanuvchi' } as never,
      transfer: {
        id: 'tr-other',
        application_id: 'app-other',
        amount: 2_500_000,
        currency: 'UZS',
        sender_card: { id: 'card-vo', card_number: '8600222200002222' } as never,
        receiver_card_id: sharedDropperCard.id,
        receiver_card: sharedDropperCard as never,
      } as never,
    });

    const { service } = createRelationsServiceHarness({
      candidateApps: [otherApp],
      extraTransfersByAppId: {
        'app-multi': [tr1, tr2],
      },
    });

    const result = await service.getRelations(appMulti);

    expect(result.stats.total_linked_applications).toBe(1);
    expect(result.stats.current_app_loss).toBe(5_000_000);
    expect(result.card_relations).toHaveLength(1);
    expect(result.card_relations[0].card.id).toBe(sharedDropperCard.id);
    expect(result.graph.nodes.some((n) => n.role === 'CRYPTO_CASHOUT')).toBe(true);
    expect(result.graph.edges.length).toBeGreaterThanOrEqual(3);
  });

  it('flags CROSS-ROLE COLLISION when a victim in App 1 appears as DROPPER/SUSPECT in App 2', async () => {
    const dualPerson = {
      id: 'cit-dual',
      full_name: 'Aralash Rol Shaxs',
      phone_number: '+998907778899',
    };
    const dualCard = {
      id: 'card-dual',
      card_number: '8600555566667777',
      citizen_id: dualPerson.id,
      citizen: dualPerson,
    };

    const appAsVictim = buildBaseApp({
      id: 'app-victim',
      citizen_id: dualPerson.id,
      citizen: dualPerson as never,
      card_id: dualCard.id,
      card: dualCard as never,
      transfer: {
        id: 'tr-v',
        application_id: 'app-victim',
        amount: 1_500_000,
        currency: 'UZS',
        sender_card: dualCard as never,
        receiver_card: { id: 'card-other-drop', card_number: '9860000011112222' } as never,
      } as never,
    });

    const appAsDropper = buildBaseApp({
      id: 'app-dropper',
      citizen_id: 'cit-other-victim',
      citizen: { id: 'cit-other-victim', full_name: 'Boshqa Jabrlanuvchi' } as never,
      transfer: {
        id: 'tr-d',
        application_id: 'app-dropper',
        amount: 9_000_000,
        currency: 'UZS',
        sender_card: { id: 'card-ov', card_number: '8600333344445555' } as never,
        receiver_card_id: dualCard.id,
        receiver_card: dualCard as never,
      } as never,
    });

    const { service } = createRelationsServiceHarness({
      candidateApps: [appAsDropper],
    });

    const result = await service.getRelations(appAsVictim);

    expect(result.stats.total_linked_applications).toBe(1);
    expect(result.stats.has_cross_role_collision).toBe(true);
    expect(result.linked_applications).toHaveLength(1);
    expect(result.linked_applications[0].is_cross_role).toBe(true);
  });

  it('excludes same-chain DUPLICATE applications from inflating fraudster link counts', async () => {
    const dropperCard = {
      id: 'card-drop-dup',
      card_number: '9860123456789012',
    };

    const primaryApp = buildBaseApp({
      id: 'app-root',
      repeat_type: ApplicationRepeatType.PRIMARY,
      root_application_id: null,
      transfer: {
        id: 'tr-root',
        application_id: 'app-root',
        amount: 3_000_000,
        currency: 'UZS',
        receiver_card_id: dropperCard.id,
        receiver_card: dropperCard as never,
      } as never,
    });

    const duplicateApp = buildBaseApp({
      id: 'app-dup',
      repeat_type: ApplicationRepeatType.DUPLICATE,
      root_application_id: 'app-root',
      transfer: {
        id: 'tr-dup',
        application_id: 'app-dup',
        amount: 3_000_000,
        currency: 'UZS',
        receiver_card_id: dropperCard.id,
        receiver_card: dropperCard as never,
      } as never,
    });

    const { service } = createRelationsServiceHarness({
      candidateApps: [duplicateApp],
    });

    const result = await service.getRelations(primaryApp);

    expect(result.stats.total_linked_applications).toBe(0);
    expect(result.linked_applications).toHaveLength(0);
    expect(result.card_relations).toHaveLength(0);
  });

  it('ignores non-linkable other_info text while matching normalized Telegram handles across apps', async () => {
    const app1 = buildBaseApp({
      id: 'app-tg-1',
      suspect_tree: [
        { field_key: 'other_info', field_label: 'Boshqa izoh', value: 'Telefon qilib aldadi' },
        { field_key: 'telegram_username', field_label: 'Telegram', value: '@Scam_Admin' },
      ] as never,
    });

    const app2SameTextOnly = buildBaseApp({
      id: 'app-text-2',
      suspect_tree: [
        { field_key: 'other_info', field_label: 'Boshqa izoh', value: 'Telefon qilib aldadi' },
        { field_key: 'telegram_bio', field_label: 'Bio', value: 'Tezkor yordam 24/7' },
      ] as never,
    });

    const app3SameTgUrl = buildBaseApp({
      id: 'app-tg-3',
      suspect_tree: [
        {
          field_key: 'telegram_username',
          field_label: 'Telegram',
          value: 'https://t.me/scam_admin/',
        },
      ] as never,
    });

    const { service } = createRelationsServiceHarness({
      candidateApps: [app2SameTextOnly, app3SameTgUrl],
    });

    const result = await service.getRelations(app1);

    expect(result.stats.total_linked_applications).toBe(1);
    expect(result.linked_applications).toHaveLength(1);
    expect(result.linked_applications[0].id).toBe('app-tg-3');
    expect(result.linked_applications.some((a) => a.id === 'app-text-2')).toBe(false);
  });

  it('enforces fraudster/cross-role SQL filtering and maps detected_crimes_count in attachRelationsSummaries', async () => {
    const queryMock = jest
      .fn()
      .mockResolvedValueOnce([
        {
          app_id: 'app-1',
          total_count: 2,
          cards_count: 1,
          citizens_count: 0,
          suspects_count: 1,
          has_fraud_link: true,
          has_cross_role: true,
        },
      ])
      .mockResolvedValueOnce([{ app_id: 'app-1', dc_count: 1 }]);

    const appRepo = { manager: { query: queryMock } } as unknown as Repository<Application>;
    const transferRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<Transfer>;
    const service = new ApplicationsRelationsService(
      appRepo,
      transferRepo,
      {} as Repository<User>,
      {} as IntelligenceService,
    );

    const items = [buildBaseApp({ id: 'app-1' }), buildBaseApp({ id: 'app-2' })];
    await service.attachRelationsSummaries(items);

    const firstCall = queryMock.mock.calls[0] as [string];
    const firstSql = String(firstCall[0]);
    expect(firstSql).toContain(
      "l1.role IN ('DROPPER', 'SUSPECT', 'TRANSIT') OR l2.role IN ('DROPPER', 'SUSPECT', 'TRANSIT')",
    );
    expect(firstSql).toContain("'DUPLICATE'");
    expect(firstSql).toContain("('telegram_bio', 'other_info')");

    expect(items[0].relations_summary).toEqual({
      total: 2,
      cards: 1,
      citizens: 0,
      suspects: 1,
      has_fraud_card_link: true,
      has_cross_role_collision: true,
      detected_crimes_count: 1,
    });
    expect(items[1].relations_summary).toEqual({
      total: 0,
      cards: 0,
      citizens: 0,
      suspects: 0,
      has_fraud_card_link: false,
      has_cross_role_collision: false,
      detected_crimes_count: 0,
    });
  });
});
