import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { In, Repository } from 'typeorm';

import { ApplicationStatus } from '../../common/enums/application-status.enum';
import { Role } from '../../common/enums/role.enum';
import { Application } from '../applications/application.entity';
import { SystemSetting } from '../audit/system-setting.entity';
import { DetectedCrime } from '../detected-crimes/entities/detected-crime.entity';
import { User } from '../users/user.entity';
import {
  Notification,
  type NotificationPriority,
  type NotificationType,
} from './notification.entity';
import { TelegramBotService } from './telegram-bot.service';

export interface NotificationPrefs {
  telegram_enabled: boolean;
  high_value: boolean;
  cross_case: boolean;
  sla: boolean;
  new_application: boolean;
  status_changed: boolean;
  daily_digest: boolean;
  security: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  telegram_enabled: true,
  high_value: true,
  cross_case: true,
  sla: true,
  new_application: true,
  status_changed: true,
  daily_digest: true,
  security: true,
};

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private lastDigestDate = '';
  private lastSlaCheckDate = '';

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SystemSetting)
    private readonly settingRepo: Repository<SystemSetting>,
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    private readonly telegramBot: TelegramBotService,
  ) {}

  onModuleInit(): void {
    // Har 15 daqiqada kunlik svodka va SLA muddatlarini tekshiradi
    this.schedulerTimer = setInterval(
      () => {
        void this.runScheduledChecks();
      },
      15 * 60 * 1000,
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private async getSettingNumber(key: string, fallback: number): Promise<number> {
    const row = await this.settingRepo.findOne({ where: { key } });
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private async getSettingBool(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.settingRepo.findOne({ where: { key } });
    if (!row) return fallback;
    return row.value === 'true';
  }

  private async setSetting(key: string, value: string, description?: string): Promise<void> {
    const existing = await this.settingRepo.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      await this.settingRepo.save(existing);
    } else {
      await this.settingRepo.save(
        this.settingRepo.create({ key, value, description: description || null }),
      );
    }
  }

  private mergePrefs(raw?: Record<string, boolean> | null): NotificationPrefs {
    return { ...DEFAULT_PREFS, ...(raw || {}) };
  }

  private shouldSendTelegramForType(type: NotificationType, prefs: NotificationPrefs): boolean {
    if (!prefs.telegram_enabled) return false;
    switch (type) {
      case 'HIGH_VALUE_ALERT':
        return prefs.high_value;
      case 'CROSS_CASE_MATCH':
        return prefs.cross_case;
      case 'SLA_WARNING':
      case 'SLA_OVERDUE':
        return prefs.sla;
      case 'NEW_APPLICATION':
        return prefs.new_application;
      case 'STATUS_CHANGED':
        return prefs.status_changed;
      case 'DAILY_DIGEST':
        return prefs.daily_digest;
      case 'SECURITY_ALERT':
        return prefs.security;
      default:
        return true;
    }
  }

  private formatTelegramHtml(
    priority: NotificationPriority,
    title: string,
    message: string,
  ): string {
    const icon = priority === 'CRITICAL' ? '🚨' : priority === 'WARNING' ? '⚠️' : 'ℹ️';
    return `${icon} <b>${this.telegramBot.escapeHtml(title)}</b>\n\n${this.telegramBot.escapeHtml(message)}`;
  }

  async notifyUser(
    user: User,
    payload: {
      type: NotificationType;
      priority: NotificationPriority;
      title: string;
      message: string;
      link_url?: string | null;
      metadata?: Record<string, unknown> | null;
      forceTelegram?: boolean;
      telegramReplyMarkup?: Record<string, unknown>;
    },
  ): Promise<Notification> {
    const prefs = this.mergePrefs(user.notification_prefs);
    let sentToTelegram = false;

    if (
      user.telegram_chat_id &&
      (payload.forceTelegram || this.shouldSendTelegramForType(payload.type, prefs))
    ) {
      const html = this.formatTelegramHtml(payload.priority, payload.title, payload.message);
      sentToTelegram = await this.telegramBot.sendMessage(
        user.telegram_chat_id,
        html,
        payload.telegramReplyMarkup,
      );
    }

    const entity = this.notifRepo.create({
      user_id: user.id,
      type: payload.type,
      priority: payload.priority,
      title: payload.title,
      message: payload.message,
      link_url: payload.link_url || null,
      metadata: payload.metadata || null,
      sent_to_telegram: sentToTelegram,
    });

    return this.notifRepo.save(entity);
  }

  async findUsersByRoles(roles: Role[], districtId?: string | null): Promise<User[]> {
    const qb = this.userRepo
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.auth', 'auth')
      .leftJoinAndSelect('user.assigned_districts', 'districts')
      .where('auth.role IN (:...roles)', { roles });

    if (districtId) {
      qb.andWhere('districts.id = :districtId', { districtId });
    }

    return qb.getMany();
  }

  /**
   * 1. Yangi ariza yaratilganda:
   * - Yirik zarar (High-Value) -> BOSS + SUPER_ADMIN
   * - Tuman mas'uli -> o'z tumaniga yangi ariza
   * - Takroriy firibgar kartasi (Cross-Case Match) -> BOSS + tegishli tuman mas'ullari + yaratuvchi
   */
  async onApplicationCreated(appId: string, actorAuthId?: string): Promise<void> {
    try {
      const app = await this.applicationRepo.findOne({
        where: { id: appId },
        relations: {
          district: true,
          citizen: true,
          crime: true,
          transfer: { receiver_card: true },
        },
      });
      if (!app) return;

      const appNum = app.application_number || 'Raqamsiz';
      const districtName = app.district?.name || 'Noma‘lum tuman';
      const citizenName = app.citizen
        ? `${app.citizen.last_name || ''} ${app.citizen.first_name || ''}`.trim()
        : 'Noma‘lum fuqaro';
      const amount = Number(app.transfer?.amount || 0);
      const formattedAmount =
        amount > 0 ? `${new Intl.NumberFormat('uz-UZ').format(Math.round(amount))} UZS` : '0 UZS';

      // A. Yirik zararli ariza (High-Value Alert -> BOSS + SUPER_ADMIN)
      const threshold = await this.getSettingNumber('notif_high_value_threshold', 50_000_000);
      if (threshold > 0 && amount >= threshold) {
        const recipients = await this.findUsersByRoles([Role.BOSS, Role.SUPER_ADMIN]);
        for (const u of recipients) {
          await this.notifyUser(u, {
            type: 'HIGH_VALUE_ALERT',
            priority: 'CRITICAL',
            title: `Yirik zararli ariza: ${formattedAmount}`,
            message: `№ ${appNum} | Hudud: ${districtName}\nArizachi: ${citizenName}\nZarar summasi: ${formattedAmount}`,
            link_url: `/applications/${app.id}`,
            metadata: { application_id: app.id, amount },
          });
        }
      }

      // B. Tuman mas'ullariga yangi ariza xabari
      if (app.district_id) {
        const districtOfficers = await this.findUsersByRoles(
          [Role.DISTRICT_OFFICER],
          app.district_id,
        );
        for (const officer of districtOfficers) {
          if (actorAuthId && officer.auth_id === actorAuthId) continue;
          await this.notifyUser(officer, {
            type: 'NEW_APPLICATION',
            priority: 'INFO',
            title: `Yangi ariza: № ${appNum} (${districtName})`,
            message: `Arizachi: ${citizenName}\nZarar: ${formattedAmount}${app.crime?.article ? `\nModda: ${app.crime.article}` : ''}`,
            link_url: `/applications/${app.id}`,
            metadata: { application_id: app.id, district_id: app.district_id },
          });
        }
      }

      // C. Takroriy firibgar kartasi (Cross-Case / Cross-District Match)
      const receiverCardId = app.transfer?.receiver_card_id;
      if (receiverCardId) {
        const matchedApps = await this.applicationRepo
          .createQueryBuilder('a')
          .leftJoinAndSelect('a.transfer', 'tr')
          .leftJoinAndSelect('a.district', 'dist')
          .where('a.is_deleted = false')
          .andWhere('tr.receiver_card_id = :cardId', { cardId: receiverCardId })
          .getMany();

        if (matchedApps.length >= 2) {
          const cardNum =
            app.transfer?.receiver_card?.card_number ||
            app.transfer?.receiver_card?.masked_number ||
            'Karta';
          const districts = Array.from(
            new Set(matchedApps.map((m) => m.district?.name).filter(Boolean)),
          );
          const districtIds = Array.from(
            new Set(
              matchedApps.map((m) => m.district_id).filter((id): id is string => Boolean(id)),
            ),
          );

          const bossAndAdmins = await this.findUsersByRoles([Role.BOSS, Role.SUPER_ADMIN]);
          const officers: User[] = [];
          for (const dId of districtIds) {
            const list = await this.findUsersByRoles([Role.DISTRICT_OFFICER], dId);
            officers.push(...list);
          }

          const uniqueUsers = new Map<string, User>();
          [...bossAndAdmins, ...officers].forEach((u) => uniqueUsers.set(u.id, u));

          for (const u of uniqueUsers.values()) {
            await this.notifyUser(u, {
              type: 'CROSS_CASE_MATCH',
              priority: 'CRITICAL',
              title: `Takroriy firibgar kartasi aniqlandi (${matchedApps.length} ta ariza)`,
              message: `Karta: ${cardNum}\nYangi ariza: № ${appNum} (${districtName})\nBarcha hududlar: ${districts.join(', ') || districtName}`,
              link_url: `/cards/${receiverCardId}`,
              metadata: {
                card_id: receiverCardId,
                application_id: app.id,
                matches_count: matchedApps.length,
              },
            });
          }
        }
      }
    } catch (err) {
      this.logger.warn(`onApplicationCreated xatosi: ${(err as Error).message}`);
    }
  }

  /**
   * 2. Ariza holati o'zgartirilganda
   */
  async onApplicationStatusChanged(
    appId: string,
    newStatusLabel: string,
    actorAuthId?: string,
  ): Promise<void> {
    try {
      const app = await this.applicationRepo.findOne({
        where: { id: appId },
        relations: { district: true },
      });
      if (!app || !app.district_id) return;

      const officers = await this.findUsersByRoles([Role.DISTRICT_OFFICER], app.district_id);
      for (const officer of officers) {
        if (actorAuthId && officer.auth_id === actorAuthId) continue;
        await this.notifyUser(officer, {
          type: 'STATUS_CHANGED',
          priority: 'INFO',
          title: `Ariza holati o'zgardi: № ${app.application_number || 'Raqamsiz'}`,
          message: `Hudud: ${app.district?.name || '—'}\nYangi holat: ${newStatusLabel}`,
          link_url: `/applications/${app.id}`,
          metadata: { application_id: app.id, status: newStatusLabel },
        });
      }
    } catch (err) {
      this.logger.warn(`onApplicationStatusChanged xatosi: ${(err as Error).message}`);
    }
  }

  /**
   * 3. Xavfsizlik signali (CrowdSec / IP bloklash -> SUPER_ADMIN)
   */
  async onSecurityAlert(
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const admins = await this.findUsersByRoles([Role.SUPER_ADMIN]);
      for (const admin of admins) {
        await this.notifyUser(admin, {
          type: 'SECURITY_ALERT',
          priority: 'CRITICAL',
          title,
          message,
          link_url: '/audit',
          metadata: metadata || null,
        });
      }
    } catch (err) {
      this.logger.warn(`onSecurityAlert xatosi: ${(err as Error).message}`);
    }
  }

  private getTashkentNowParts(): { dateStr: string; hour: number; startOfDayUtc: Date } {
    // O'zbekiston vaqti: UTC+5 (DST yo'q)
    const nowUtcMs = Date.now();
    const uzOffsetMs = 5 * 60 * 60 * 1000;
    const uzDate = new Date(nowUtcMs + uzOffsetMs);
    const yyyy = uzDate.getUTCFullYear();
    const mm = String(uzDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(uzDate.getUTCDate()).padStart(2, '0');
    const hour = uzDate.getUTCHours();
    const startOfDayUtc = new Date(
      Date.UTC(yyyy, uzDate.getUTCMonth(), uzDate.getUTCDate()) - uzOffsetMs,
    );
    return { dateStr: `${yyyy}-${mm}-${dd}`, hour, startOfDayUtc };
  }

  /**
   * 4. Kunlik Telegram & In-App Svodka (BOSS + SUPER_ADMIN)
   * Excel fayl oldindan saqlanmaydi — hodim/rahbar tugmani bosganda on-demand generatsiya qilinadi.
   */
  async sendDailyDigest(): Promise<{ sentCount: number }> {
    const { dateStr, startOfDayUtc } = this.getTashkentNowParts();

    const todayApps = await this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.application_status', 'application_status')
      .where('app.is_deleted = false')
      .andWhere('app.created_at >= :startOfDay', { startOfDay: startOfDayUtc })
      .getMany();

    const totalCount = todayApps.length;
    let totalLoss = 0;

    if (totalCount > 0) {
      const appIds = todayApps.map((a) => a.id);
      const lossRows: Array<{ total: string | number | null }> =
        await this.applicationRepo.manager.query(
          `SELECT COALESCE(SUM(t.amount), 0) AS total
           FROM transfers t
           WHERE (t.currency IS NULL OR UPPER(t.currency) = 'UZS')
             AND (
               t.application_id = ANY($1::uuid[])
               OR t.id IN (SELECT transfer_id FROM applications WHERE id = ANY($1::uuid[]) AND transfer_id IS NOT NULL)
             )`,
          [appIds],
        );
      totalLoss = Number(lossRows[0]?.total || 0);
    }

    const resolvedCount = todayApps.filter(
      (a) =>
        a.status === ApplicationStatus.HAL_QILINDI ||
        String(a.application_status?.category || '') === 'CLOSED',
    ).length;

    const detectedRows: Array<{ cnt: number }> = await this.applicationRepo.manager.query(
      `SELECT COUNT(*)::int AS cnt
       FROM detected_crimes
       WHERE is_deleted = false AND created_at >= $1`,
      [startOfDayUtc],
    );
    const todayDetectedCount = detectedRows[0]?.cnt ?? 0;

    const overdueSlaRows: Array<{ cnt: number }> = await this.applicationRepo.manager.query(
      `SELECT COUNT(*)::int AS cnt
       FROM applications a
       LEFT JOIN application_statuses s ON s.id = a.status_id
       WHERE a.is_deleted = false
         AND a.deadline_at IS NOT NULL
         AND a.deadline_at < NOW()
         AND a.closed_at IS NULL
         AND COALESCE(s.category, '') <> 'CLOSED'
         AND a.status NOT IN ('HAL_QILINDI', 'RAD_ETILDI')`,
    );
    const overdueSlaCount = overdueSlaRows[0]?.cnt ?? 0;

    const districtCounts = new Map<string, number>();
    for (const a of todayApps) {
      const dName = a.district?.name || "Noma'lum";
      districtCounts.set(dName, (districtCounts.get(dName) || 0) + 1);
    }
    const topDistricts = Array.from(districtCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, cnt]) => `${name} (${cnt})`)
      .join(', ');

    const formattedLoss = `${new Intl.NumberFormat('uz-UZ').format(Math.round(totalLoss))} UZS`;
    const message =
      `Sana: ${dateStr}\n` +
      `Bugungi arizalar: ${totalCount} ta (Yopilgan: ${resolvedCount} ta)\n` +
      `Aniqlangan jinoyatlar: ${todayDetectedCount} ta\n` +
      `Umumiy zarar: ${formattedLoss}` +
      (overdueSlaCount > 0 ? `\nMuddati o'tgan (SLA): ${overdueSlaCount} ta` : '') +
      (topDistricts ? `\nFaol hududlar: ${topDistricts}` : '');

    const recipients = await this.findUsersByRoles([Role.BOSS, Role.SUPER_ADMIN]);
    let sentCount = 0;
    for (const u of recipients) {
      await this.notifyUser(u, {
        type: 'DAILY_DIGEST',
        priority: overdueSlaCount > 0 ? 'WARNING' : 'INFO',
        title: `Kunlik Svodka (${dateStr})`,
        message,
        link_url: `/reports?tab=matrix&date=${dateStr}`,
        metadata: {
          date: dateStr,
          totalCount,
          resolvedCount,
          todayDetectedCount,
          overdueSlaCount,
          totalLoss,
          excelExportType: 'operational_matrix',
        },
        telegramReplyMarkup: {
          inline_keyboard: [
            [
              {
                text: `📊 Excel svodkani yuklab olish (${dateStr})`,
                callback_data: `svodka_excel:${dateStr}`,
              },
            ],
          ],
        },
      });
      sentCount++;
    }
    return { sentCount };
  }

  /**
   * 5. BullMQ SLA bosqichi ishga tushganda bosqichma-bosqich eskalatsiya yuborish
   */
  async dispatchSlaStageNotification(
    app: Application,
    stage: 'WARN_72H' | 'URGENT_24H' | 'OVERDUE_0H' | 'ESCALATE_24H',
  ): Promise<void> {
    try {
      const appNum = app.application_number || 'Raqamsiz';
      const districtName = app.district?.name || 'Noma‘lum tuman';
      const statusName = app.application_status?.name || app.status || 'Jarayonda';
      const deadlineStr = app.deadline_at
        ? new Date(app.deadline_at).toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';

      const recipientMap = new Map<string, User>();
      const addUsers = (list: User[]) => {
        for (const u of list) recipientMap.set(u.id, u);
      };

      const districtOfficers = app.district_id
        ? await this.findUsersByRoles([Role.DISTRICT_OFFICER], app.district_id)
        : [];
      const creatorUser = app.created_by_id
        ? await this.userRepo.findOne({ where: { id: app.created_by_id } })
        : null;

      let type: NotificationType = 'SLA_WARNING';
      let priority: NotificationPriority = 'WARNING';
      let title = '';
      let message = '';

      if (stage === 'WARN_72H') {
        addUsers(districtOfficers);
        if (creatorUser) addUsers([creatorUser]);
        type = 'SLA_WARNING';
        priority = 'WARNING';
        title = `Muddat yaqinlashmoqda: Ariza № ${appNum}`;
        message = `Hudud: ${districtName}\nHolat: ${statusName}\nProtsessual muddat: ${deadlineStr}\nMuddat tugashidan oldin qaror qabul qiling yoki JPK 329-m. bo‘yicha uzaytiring.`;
      } else if (stage === 'URGENT_24H') {
        addUsers(districtOfficers);
        if (creatorUser) addUsers([creatorUser]);
        type = 'SLA_WARNING';
        priority = 'WARNING';
        title = `Shoshilinch! 24 soat qoldi: Ariza № ${appNum}`;
        message = `Hudud: ${districtName}\nHolat: ${statusName}\nMuddat tugash vaqti: ${deadlineStr}\nIltimos, zudlik bilan choralar ko‘ring.`;
      } else if (stage === 'OVERDUE_0H') {
        addUsers(districtOfficers);
        if (creatorUser) addUsers([creatorUser]);
        addUsers(await this.findUsersByRoles([Role.BOSS]));
        type = 'SLA_OVERDUE';
        priority = 'CRITICAL';
        title = `Muddat tugadi (Kechikish): Ariza № ${appNum}`;
        message = `Hudud: ${districtName}\nHolat: ${statusName}\nBelgilangan muddat (${deadlineStr}) yakunlandi! Rahbar nazoratiga o‘tkazildi.`;
      } else {
        addUsers(await this.findUsersByRoles([Role.BOSS, Role.SUPER_ADMIN]));
        type = 'SLA_OVERDUE';
        priority = 'CRITICAL';
        title = `ESKALATSIYA (Muddati o‘tgan): Ariza № ${appNum}`;
        message = `Hudud: ${districtName}\nHolat: ${statusName}\nMuddat: ${deadlineStr} dan beri yopilmagan! Zudlik bilan rahbar va administrator nazorati talab etiladi.`;
      }

      for (const u of recipientMap.values()) {
        await this.notifyUser(u, {
          type,
          priority,
          title,
          message,
          link_url: `/applications/${app.id}`,
          metadata: { application_id: app.id, stage, deadline_at: app.deadline_at },
        });
      }
    } catch (err) {
      this.logger.warn(`dispatchSlaStageNotification xatosi: ${(err as Error).message}`);
    }
  }

  /**
   * 6. Muddat uzaytirilganda BOSS va tuman mas'ullariga xabar
   */
  async onDeadlineExtended(
    app: Application,
    newDeadline: Date,
    reason: string,
    actorAuthId?: string,
  ): Promise<void> {
    try {
      const appNum = app.application_number || 'Raqamsiz';
      const districtName = app.district?.name || 'Noma‘lum tuman';
      const dateStr = newDeadline.toLocaleDateString('uz-UZ');
      const bosses = await this.findUsersByRoles([Role.BOSS]);
      const officers = app.district_id
        ? await this.findUsersByRoles([Role.DISTRICT_OFFICER], app.district_id)
        : [];

      const unique = new Map<string, User>();
      [...bosses, ...officers].forEach((u) => {
        if (!actorAuthId || u.auth_id !== actorAuthId) unique.set(u.id, u);
      });

      for (const u of unique.values()) {
        await this.notifyUser(u, {
          type: 'STATUS_CHANGED',
          priority: 'INFO',
          title: `Muddat uzaytirildi: Ariza № ${appNum}`,
          message: `Hudud: ${districtName}\nYangi muddat: ${dateStr}\nAsos: ${reason}`,
          link_url: `/applications/${app.id}`,
          metadata: { application_id: app.id, new_deadline: newDeadline.toISOString() },
        });
      }
    } catch (err) {
      this.logger.warn(`onDeadlineExtended xatosi: ${(err as Error).message}`);
    }
  }

  /**
   * 7. Aniqlangan jinoyat (DetectedCrime) uchun BullMQ SLA bosqichi eskalatsiyasi
   */
  async dispatchDetectedCrimeSlaNotification(
    dc: DetectedCrime,
    stage: 'WARN_72H' | 'URGENT_24H' | 'OVERDUE_0H' | 'ESCALATE_24H',
  ): Promise<void> {
    try {
      const code = dc.case_number || 'Kodsiz';
      const districtName = dc.district?.name || 'Noma‘lum tuman';
      const statusName = dc.application_status?.name || 'Jarayonda';
      const deadlineStr = dc.deadline_at
        ? new Date(dc.deadline_at).toLocaleString('uz-UZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';

      const recipientMap = new Map<string, User>();
      const addUsers = (list: User[]) => {
        for (const u of list) recipientMap.set(u.id, u);
      };

      const districtOfficers = dc.district_id
        ? await this.findUsersByRoles([Role.DISTRICT_OFFICER], dc.district_id)
        : [];
      const creatorId = dc.created_by_id || dc.detected_by_id;
      const creatorUser = creatorId
        ? await this.userRepo.findOne({ where: { id: creatorId } })
        : null;

      let type: NotificationType = 'SLA_WARNING';
      let priority: NotificationPriority = 'WARNING';
      let title = '';
      let message = '';

      if (stage === 'WARN_72H') {
        addUsers(districtOfficers);
        if (creatorUser) addUsers([creatorUser]);
        type = 'SLA_WARNING';
        priority = 'WARNING';
        title = `Muddat yaqinlashmoqda: Aniqlangan jinoyat ${code}`;
        message = `Sarlavha: ${dc.title}\nHudud: ${districtName}\nHolat: ${statusName}\nProtsessual muddat: ${deadlineStr}`;
      } else if (stage === 'URGENT_24H') {
        addUsers(districtOfficers);
        if (creatorUser) addUsers([creatorUser]);
        type = 'SLA_WARNING';
        priority = 'WARNING';
        title = `Shoshilinch! 24 soat qoldi: Aniqlangan jinoyat ${code}`;
        message = `Sarlavha: ${dc.title}\nHudud: ${districtName}\nMuddat tugash vaqti: ${deadlineStr}`;
      } else if (stage === 'OVERDUE_0H') {
        addUsers(districtOfficers);
        if (creatorUser) addUsers([creatorUser]);
        addUsers(await this.findUsersByRoles([Role.BOSS]));
        type = 'SLA_OVERDUE';
        priority = 'CRITICAL';
        title = `Muddat tugadi (Kechikish): Aniqlangan jinoyat ${code}`;
        message = `Sarlavha: ${dc.title}\nHudud: ${districtName}\nBelgilangan muddat (${deadlineStr}) yakunlandi! Rahbar nazoratiga o‘tkazildi.`;
      } else {
        addUsers(await this.findUsersByRoles([Role.BOSS, Role.SUPER_ADMIN]));
        type = 'SLA_OVERDUE';
        priority = 'CRITICAL';
        title = `ESKALATSIYA (Muddati o‘tgan): Aniqlangan jinoyat ${code}`;
        message = `Sarlavha: ${dc.title}\nHudud: ${districtName}\nMuddat: ${deadlineStr} dan beri yopilmagan!`;
      }

      for (const u of recipientMap.values()) {
        await this.notifyUser(u, {
          type,
          priority,
          title,
          message,
          link_url: `/detected-crimes/${dc.id}`,
          metadata: { detected_crime_id: dc.id, stage, deadline_at: dc.deadline_at },
        });
      }
    } catch (err) {
      this.logger.warn(`dispatchDetectedCrimeSlaNotification xatosi: ${(err as Error).message}`);
    }
  }

  async onDetectedCrimeDeadlineExtended(
    dc: DetectedCrime,
    newDeadline: Date,
    reason: string,
    actorAuthId?: string,
  ): Promise<void> {
    try {
      const code = dc.case_number || 'Kodsiz';
      const districtName = dc.district?.name || 'Noma‘lum tuman';
      const dateStr = newDeadline.toLocaleDateString('uz-UZ');
      const bosses = await this.findUsersByRoles([Role.BOSS]);
      const officers = dc.district_id
        ? await this.findUsersByRoles([Role.DISTRICT_OFFICER], dc.district_id)
        : [];

      const unique = new Map<string, User>();
      [...bosses, ...officers].forEach((u) => {
        if (!actorAuthId || u.auth_id !== actorAuthId) unique.set(u.id, u);
      });

      for (const u of unique.values()) {
        await this.notifyUser(u, {
          type: 'STATUS_CHANGED',
          priority: 'INFO',
          title: `Muddat uzaytirildi: Aniqlangan jinoyat ${code}`,
          message: `Sarlavha: ${dc.title}\nHudud: ${districtName}\nYangi muddat: ${dateStr}\nAsos: ${reason}`,
          link_url: `/detected-crimes/${dc.id}`,
          metadata: { detected_crime_id: dc.id, new_deadline: newDeadline.toISOString() },
        });
      }
    } catch (err) {
      this.logger.warn(`onDetectedCrimeDeadlineExtended xatosi: ${(err as Error).message}`);
    }
  }

  private async runScheduledChecks(): Promise<void> {
    try {
      const { dateStr: todayKey, hour: uzHour } = this.getTashkentNowParts();

      // 1. Kunlik svodka (O'zbekiston vaqti bilan)
      const digestEnabled = await this.getSettingBool('notif_daily_digest_enabled', true);
      const digestHour = await this.getSettingNumber('notif_daily_digest_hour', 18);
      if (digestEnabled && uzHour === digestHour && this.lastDigestDate !== todayKey) {
        this.lastDigestDate = todayKey;
        await this.sendDailyDigest();
      }

      // 2. SLA muddat nazorati endi BullMQ (SlaQueueService) delayed joblari orqali sekundigacha aniq ishlaydi
    } catch (err) {
      this.logger.warn(`Scheduled notification check xatosi: ${(err as Error).message}`);
    }
  }

  async checkSlaDeadlines(): Promise<void> {
    const slaDays = await this.getSettingNumber('notif_sla_days', 10);
    if (slaDays <= 0) return;

    const openApps = await this.applicationRepo.find({
      where: {
        is_deleted: false,
        status: In([ApplicationStatus.YANGI, ApplicationStatus.JARAYONDA]),
      },
      relations: { district: true },
    });

    const nowMs = Date.now();
    const bosses = await this.findUsersByRoles([Role.BOSS]);

    for (const app of openApps) {
      const baseDate = app.date || app.created_at;
      const ageDays = Math.floor((nowMs - new Date(baseDate).getTime()) / (1000 * 60 * 60 * 24));
      const daysLeft = slaDays - ageDays;

      if (daysLeft === 2 || daysLeft === 1) {
        if (app.district_id) {
          const officers = await this.findUsersByRoles([Role.DISTRICT_OFFICER], app.district_id);
          for (const u of officers) {
            await this.notifyUser(u, {
              type: 'SLA_WARNING',
              priority: 'WARNING',
              title: `Muddat yaqinlashmoqda (${daysLeft} kun qoldi)`,
              message: `Ariza № ${app.application_number || 'Raqamsiz'} (${app.district?.name || '—'}) ko‘rib chiqish muddati tugashiga ${daysLeft} kun qoldi.`,
              link_url: `/applications/${app.id}`,
            });
          }
        }
      } else if (daysLeft === 0 || daysLeft === -1) {
        const recipients = [...bosses];
        if (app.district_id) {
          const officers = await this.findUsersByRoles([Role.DISTRICT_OFFICER], app.district_id);
          recipients.push(...officers);
        }
        const unique = new Map<string, User>();
        recipients.forEach((u) => unique.set(u.id, u));

        for (const u of unique.values()) {
          await this.notifyUser(u, {
            type: 'SLA_OVERDUE',
            priority: 'CRITICAL',
            title: `Ariza muddati o'tdi: № ${app.application_number || 'Raqamsiz'}`,
            message: `Hudud: ${app.district?.name || '—'} | Ochilganiga ${ageDays} kun bo‘ldi (limit: ${slaDays} kun).`,
            link_url: `/applications/${app.id}`,
          });
        }
      }
    }
  }

  // ===== USER ENDPOINTS =====

  async getMyNotifications(authId: string, page = 1, limit = 20) {
    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    if (!user) {
      return { items: [], unreadCount: 0, meta: { total: 0, page, limit, totalPages: 1 } };
    }

    const [items, total] = await this.notifRepo.findAndCount({
      where: { user_id: user.id },
      order: { created_at: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    const unreadCount = await this.notifRepo.count({
      where: { user_id: user.id, is_read: false },
    });

    return {
      items,
      unreadCount,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async markAsRead(authId: string, notifId: string) {
    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    if (!user) return { success: false };

    await this.notifRepo.update(
      { id: notifId, user_id: user.id },
      { is_read: true, read_at: new Date() },
    );
    return { success: true };
  }

  async markAllAsRead(authId: string) {
    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    if (!user) return { success: false };

    await this.notifRepo.update(
      { user_id: user.id, is_read: false },
      { is_read: true, read_at: new Date() },
    );
    return { success: true };
  }

  async getMyPreferences(authId: string) {
    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    const bot = await this.telegramBot.getConfigView();
    return {
      telegram_connected: Boolean(user?.telegram_chat_id),
      telegram_username: user?.telegram_username || null,
      telegram_first_name: user?.telegram_first_name || null,
      bot_available: bot.enabled && Boolean(bot.bot_username),
      bot_username: bot.bot_username,
      bot_name: bot.bot_name,
      prefs: this.mergePrefs(user?.notification_prefs),
    };
  }

  async updateMyPreferences(authId: string, prefs: Partial<NotificationPrefs>) {
    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    if (!user) return { success: false };

    user.notification_prefs = {
      ...this.mergePrefs(user.notification_prefs),
      ...prefs,
    };
    await this.userRepo.save(user);
    return this.getMyPreferences(authId);
  }

  async generateTelegramLink(authId: string) {
    const bot = await this.telegramBot.getConfigView();
    if (!bot.enabled || !bot.bot_username) {
      return {
        available: false,
        message: 'Telegram Bot hali Super Admin tomonidan sozlanmagan',
      };
    }

    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    if (!user) {
      return { available: false, message: 'Foydalanuvchi profili topilmadi' };
    }

    const token = crypto.randomBytes(16).toString('hex');
    user.telegram_link_token = token;
    user.telegram_link_expires_at = new Date(Date.now() + 15 * 60 * 1000);
    await this.userRepo.save(user);

    return {
      available: true,
      deep_link: `https://t.me/${bot.bot_username}?start=${token}`,
      bot_username: bot.bot_username,
      expires_in_minutes: 15,
    };
  }

  async unlinkTelegram(authId: string) {
    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    if (!user) return { success: false };

    user.telegram_chat_id = null;
    user.telegram_username = null;
    user.telegram_first_name = null;
    user.telegram_link_token = null;
    user.telegram_link_expires_at = null;
    await this.userRepo.save(user);
    return { success: true };
  }

  async sendTestNotification(authId: string) {
    const user = await this.userRepo.findOne({ where: { auth_id: authId } });
    if (!user) return { success: false, sentToTelegram: false };

    const notif = await this.notifyUser(user, {
      type: 'SYSTEM',
      priority: 'INFO',
      title: 'Sinov bildirishnomasi',
      message: 'Tizim va Telegram Bot bildirishnomalari muvaffaqiyatli ishlayapti!',
      link_url: '/profile',
      forceTelegram: true,
    });
    return { success: true, sentToTelegram: notif.sent_to_telegram };
  }

  // ===== SUPER ADMIN SETTINGS =====

  async getAdminSettings() {
    const bot = await this.telegramBot.getConfigView();
    const highValueThreshold = await this.getSettingNumber(
      'notif_high_value_threshold',
      50_000_000,
    );
    const slaDays = await this.getSettingNumber('notif_sla_days', 10);
    const slaWarnHoursBefore = await this.getSettingNumber('sla_warn_hours_before', 72);
    const slaUrgentHoursBefore = await this.getSettingNumber('sla_urgent_hours_before', 24);
    const slaEscalateHoursAfter = await this.getSettingNumber('sla_escalate_hours_after', 24);
    const slaMaxExtensionDays = await this.getSettingNumber('sla_max_extension_days', 30);
    const dailyDigestEnabled = await this.getSettingBool('notif_daily_digest_enabled', true);
    const dailyDigestHour = await this.getSettingNumber('notif_daily_digest_hour', 18);

    const linkedUsersCount = await this.userRepo
      .createQueryBuilder('u')
      .where('u.telegram_chat_id IS NOT NULL')
      .getCount();

    return {
      bot,
      linkedUsersCount,
      rules: {
        high_value_threshold: highValueThreshold,
        sla_days: slaDays,
        sla_warn_hours_before: slaWarnHoursBefore,
        sla_urgent_hours_before: slaUrgentHoursBefore,
        sla_escalate_hours_after: slaEscalateHoursAfter,
        sla_max_extension_days: slaMaxExtensionDays,
        daily_digest_enabled: dailyDigestEnabled,
        daily_digest_hour: dailyDigestHour,
      },
    };
  }

  async updateAdminRules(dto: {
    high_value_threshold?: number;
    sla_days?: number;
    sla_warn_hours_before?: number;
    sla_urgent_hours_before?: number;
    sla_escalate_hours_after?: number;
    sla_max_extension_days?: number;
    daily_digest_enabled?: boolean;
    daily_digest_hour?: number;
  }) {
    if (dto.high_value_threshold !== undefined) {
      await this.setSetting(
        'notif_high_value_threshold',
        String(Math.max(0, Math.round(dto.high_value_threshold))),
      );
    }
    if (dto.sla_days !== undefined) {
      await this.setSetting('notif_sla_days', String(Math.max(1, Math.min(365, dto.sla_days))));
    }
    if (dto.sla_warn_hours_before !== undefined) {
      await this.setSetting(
        'sla_warn_hours_before',
        String(Math.max(0, Math.min(720, Math.round(dto.sla_warn_hours_before)))),
      );
    }
    if (dto.sla_urgent_hours_before !== undefined) {
      await this.setSetting(
        'sla_urgent_hours_before',
        String(Math.max(0, Math.min(720, Math.round(dto.sla_urgent_hours_before)))),
      );
    }
    if (dto.sla_escalate_hours_after !== undefined) {
      await this.setSetting(
        'sla_escalate_hours_after',
        String(Math.max(0, Math.min(720, Math.round(dto.sla_escalate_hours_after)))),
      );
    }
    if (dto.sla_max_extension_days !== undefined) {
      await this.setSetting(
        'sla_max_extension_days',
        String(Math.max(1, Math.min(365, Math.round(dto.sla_max_extension_days)))),
      );
    }
    if (dto.daily_digest_enabled !== undefined) {
      await this.setSetting(
        'notif_daily_digest_enabled',
        dto.daily_digest_enabled ? 'true' : 'false',
      );
    }
    if (dto.daily_digest_hour !== undefined) {
      await this.setSetting(
        'notif_daily_digest_hour',
        String(Math.max(0, Math.min(23, Math.round(dto.daily_digest_hour)))),
      );
    }
    return this.getAdminSettings();
  }
}
