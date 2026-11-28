import type { Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { Application } from '../applications/application.entity';
import type { SystemSetting } from '../audit/system-setting.entity';
import type { RedisService } from '../redis/redis.service';
import type { User } from '../users/user.entity';
import type { Notification } from './notification.entity';
import { NotificationsService } from './notifications.service';
import type { TelegramBotService } from './telegram-bot.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    auth_id: 'auth-1',
    telegram_chat_id: '10001',
    notification_prefs: null,
    ...overrides,
  } as User;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notifRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  let userRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let settingRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let applicationRepo: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { query: jest.Mock };
  };
  let telegramBot: {
    escapeHtml: jest.Mock;
    sendMessage: jest.Mock;
    getConfigView: jest.Mock;
  };
  let redisService: {
    getClient: jest.Mock;
    setNx: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(() => {
    notifRepo = {
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
      createQueryBuilder: jest.fn(),
    };
    settingRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
    };
    applicationRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: { query: jest.fn() },
    };
    telegramBot = {
      escapeHtml: jest.fn((s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')),
      sendMessage: jest.fn().mockResolvedValue(true),
      getConfigView: jest.fn().mockResolvedValue({
        enabled: true,
        bot_username: 'uvd_test_bot',
        bot_name: 'UVD Bot',
      }),
    };
    redisService = {
      getClient: jest.fn(() => ({})),
      setNx: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockResolvedValue(undefined),
    };

    service = new NotificationsService(
      notifRepo as unknown as Repository<Notification>,
      userRepo as unknown as Repository<User>,
      settingRepo as unknown as Repository<SystemSetting>,
      applicationRepo as unknown as Repository<Application>,
      telegramBot as unknown as TelegramBotService,
      redisService as unknown as RedisService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('notifyUser preference & Telegram gating', () => {
    it('skips Telegram when user disabled the notification category, but forces Telegram when forceTelegram=true', async () => {
      const user = makeUser({
        notification_prefs: { telegram_enabled: true, high_value: false },
      });

      const saved1 = await service.notifyUser(user, {
        type: 'HIGH_VALUE_ALERT',
        priority: 'CRITICAL',
        title: 'Alert <script>',
        message: 'Body',
      });
      expect(telegramBot.sendMessage).not.toHaveBeenCalled();
      expect(saved1.sent_to_telegram).toBe(false);

      const saved2 = await service.notifyUser(user, {
        type: 'HIGH_VALUE_ALERT',
        priority: 'INFO',
        title: 'Test <tag>',
        message: 'Msg',
        forceTelegram: true,
      });
      expect(telegramBot.sendMessage).toHaveBeenCalledWith(
        '10001',
        expect.stringContaining('&lt;tag&gt;'),
        undefined,
      );
      expect(saved2.sent_to_telegram).toBe(true);
    });
  });

  describe('onApplicationCreated', () => {
    it('ignores soft-deleted applications (passes is_deleted: false)', async () => {
      applicationRepo.findOne.mockResolvedValue(null);
      await service.onApplicationCreated('deleted-app-1');

      expect(applicationRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'deleted-app-1', is_deleted: false } }),
      );
      expect(notifRepo.save).not.toHaveBeenCalled();
    });

    it('dispatches HIGH_VALUE_ALERT, NEW_APPLICATION (skipping actor), and batched deduplicated CROSS_CASE_MATCH', async () => {
      const boss = makeUser({ id: 'u-boss', auth_id: 'a-boss' });
      const officerA = makeUser({ id: 'u-off-a', auth_id: 'a-off-a' }); // actor -> skipped in NEW_APPLICATION
      const officerB = makeUser({ id: 'u-off-b', auth_id: 'a-off-b' });

      applicationRepo.findOne.mockResolvedValue({
        id: 'app-1',
        application_number: '2026-0100',
        district_id: 'd-A',
        district: { name: 'Qarshi sh.' },
        citizen: { full_name: 'Karimov Ali' },
        crime: { article: '168-modda' },
        transfer: {
          amount: 80_000_000,
          receiver_card_id: 'card-fraud-1',
          receiver_card: { card_number: '8600123456789012' },
        },
      });

      const appQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'app-1', district_id: 'd-A', district: { name: 'Qarshi sh.' } },
          { id: 'app-0', district_id: 'd-B', district: { name: 'Shahrisabz' } },
        ]),
      };
      applicationRepo.createQueryBuilder.mockReturnValue(appQb);

      const findUsersSpy = jest
        .spyOn(service, 'findUsersByRoles')
        .mockResolvedValueOnce([boss]) // HIGH_VALUE_ALERT
        .mockResolvedValueOnce([officerA, officerB]) // NEW_APPLICATION for d-A
        .mockResolvedValueOnce([boss]) // CROSS_CASE boss/admins
        .mockResolvedValueOnce([officerA, officerB]); // CROSS_CASE batched officers for ['d-A', 'd-B']

      await service.onApplicationCreated('app-1', 'a-off-a');

      // Batched district lookup: 1 call with ['d-A', 'd-B'] instead of 2 sequential queries!
      expect(findUsersSpy).toHaveBeenCalledWith([Role.DISTRICT_OFFICER], ['d-A', 'd-B']);

      const savedNotifs = (notifRepo.save.mock.calls as Array<[Notification]>).map((c) => c[0]);
      // 1 HIGH_VALUE (boss) + 1 NEW_APPLICATION (officerB only; officerA skipped) + 3 CROSS_CASE (boss, officerA, officerB)
      expect(savedNotifs).toHaveLength(5);
      expect(savedNotifs.filter((n) => n.type === 'NEW_APPLICATION').map((n) => n.user_id)).toEqual(
        ['u-off-b'],
      );
      const crossCase = savedNotifs.find((n) => n.type === 'CROSS_CASE_MATCH');
      expect(crossCase?.message).not.toContain('8600123456789012'); // card number masked!
    });
  });

  describe('dispatchSlaStageNotification escalation matrix', () => {
    it('routes WARN_72H to officers+creator, OVERDUE_0H adds BOSS, and ESCALATE_24H alerts BOSS+SUPER_ADMIN', async () => {
      const officer = makeUser({ id: 'u-off' });
      const creator = makeUser({ id: 'u-creator' });
      const boss = makeUser({ id: 'u-boss' });
      const superAdmin = makeUser({ id: 'u-sa' });

      userRepo.findOne.mockResolvedValue(creator);
      jest.spyOn(service, 'findUsersByRoles').mockImplementation((roles: Role[]) => {
        if (roles.includes(Role.DISTRICT_OFFICER)) return Promise.resolve([officer]);
        if (roles.includes(Role.SUPER_ADMIN)) return Promise.resolve([boss, superAdmin]);
        if (roles.includes(Role.BOSS)) return Promise.resolve([boss]);
        return Promise.resolve([]);
      });

      const app = {
        id: 'app-sla',
        application_number: 'AR-1',
        district_id: 'd-1',
        district: { name: 'Qarshi' },
        created_by_id: 'u-creator',
        deadline_at: new Date('2026-12-01T12:00:00Z'),
      } as Application;

      await service.dispatchSlaStageNotification(app, 'WARN_72H');
      let saved = (notifRepo.save.mock.calls as Array<[Notification]>).map((c) => c[0]);
      expect(saved.map((n) => n.user_id).sort()).toEqual(['u-creator', 'u-off']);
      expect(saved[0].type).toBe('SLA_WARNING');

      notifRepo.save.mockClear();
      await service.dispatchSlaStageNotification(app, 'OVERDUE_0H');
      saved = (notifRepo.save.mock.calls as Array<[Notification]>).map((c) => c[0]);
      expect(saved.map((n) => n.user_id).sort()).toEqual(['u-boss', 'u-creator', 'u-off']);
      expect(saved[0].type).toBe('SLA_OVERDUE');
      expect(saved[0].priority).toBe('CRITICAL');

      notifRepo.save.mockClear();
      await service.dispatchSlaStageNotification(app, 'ESCALATE_24H');
      saved = (notifRepo.save.mock.calls as Array<[Notification]>).map((c) => c[0]);
      expect(saved.map((n) => n.user_id).sort()).toEqual(['u-boss', 'u-sa']);
    });
  });

  describe('pagination, preference whitelisting & admin rule sanitization', () => {
    it('clamps bad pagination parameters in getMyNotifications', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ id: 'u-1' }));
      const res = await service.getMyNotifications('auth-1', 0, 5000);

      expect(notifRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 100, totalPages: 1 });
    });

    it('strips injected unknown/non-boolean keys in updateMyPreferences', async () => {
      const user = makeUser({ id: 'u-1', notification_prefs: undefined });
      userRepo.findOne.mockResolvedValue(user);

      await service.updateMyPreferences('auth-1', {
        sla: false,
        high_value: 'yes' as unknown as boolean,
        __injected: true,
      } as unknown as Record<string, boolean>);

      expect(user.notification_prefs).toEqual(
        expect.objectContaining({ sla: false, high_value: true }),
      );
      expect('__injected' in (user.notification_prefs || {})).toBe(false);
    });

    it('ignores NaN/Infinity, clamps bounds, and falls back on empty string setting', async () => {
      settingRepo.findOne.mockImplementation(({ where }: { where: { key: string } }) =>
        where.key === 'notif_sla_days'
          ? Promise.resolve({ key: 'notif_sla_days', value: '   ' })
          : Promise.resolve(null),
      );
      userRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      });

      const res = await service.updateAdminRules({
        high_value_threshold: Number.NaN,
        sla_days: 999,
        daily_digest_hour: -4,
      });

      const savedKeys = (
        settingRepo.save.mock.calls as Array<[{ key: string; value: string }]>
      ).map((c) => [c[0].key, c[0].value]);
      // NaN skipped (NOT saved as "NaN"), sla_days clamped to 365, digest hour clamped to 0
      expect(savedKeys).not.toContainEqual(['notif_high_value_threshold', 'NaN']);
      expect(savedKeys).toContainEqual(['notif_sla_days', '365']);
      expect(savedKeys).toContainEqual(['notif_daily_digest_hour', '0']);
      // Empty string '   ' in DB falls back to default 10, NOT 0!
      expect(res.rules.sla_days).toBe(10);
    });
  });

  describe('scheduled daily digest lock recovery', () => {
    it('releases Redis lock if sendDailyDigest fails so next tick can retry', async () => {
      // Mock Tashkent hour === 18
      jest
        .spyOn(
          service as unknown as {
            getTashkentNowParts: () => { dateStr: string; hour: number; startOfDayUtc: Date };
          },
          'getTashkentNowParts',
        )
        .mockReturnValue({
          dateStr: '2026-11-28',
          hour: 18,
          startOfDayUtc: new Date('2026-11-27T19:00:00Z'),
        });
      jest.spyOn(service, 'sendDailyDigest').mockRejectedValueOnce(new Error('DB transient error'));

      await (
        service as unknown as { runScheduledChecks: () => Promise<void> }
      ).runScheduledChecks();

      expect(redisService.setNx).toHaveBeenCalledWith(
        'notif:daily_digest_lock:2026-11-28',
        '1',
        23 * 3600,
      );
      expect(redisService.del).toHaveBeenCalledWith('notif:daily_digest_lock:2026-11-28');
    });
  });
});
