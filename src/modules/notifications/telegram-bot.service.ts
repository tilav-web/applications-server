import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SystemSetting } from '../audit/system-setting.entity';
import { User } from '../users/user.entity';

interface TelegramGetMeResponse {
  ok: boolean;
  description?: string;
  result?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string; first_name?: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    text?: string;
  };
}

export interface TelegramBotConfigView {
  is_configured: boolean;
  enabled: boolean;
  polling_active: boolean;
  bot_id: string | null;
  bot_username: string | null;
  bot_name: string | null;
  token_masked: string | null;
}

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private activeToken: string | null = null;
  private isEnabled = false;
  private isPolling = false;
  private pollAbortController: AbortController | null = null;
  private lastUpdateId = 0;

  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepo: Repository<SystemSetting>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reloadFromSettings();
    } catch (err) {
      this.logger.warn(`Telegram bot init skipped: ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.stopPolling();
  }

  private async getSetting(key: string): Promise<string> {
    const row = await this.settingRepo.findOne({ where: { key } });
    return row?.value || '';
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

  async reloadFromSettings(): Promise<void> {
    const token = (await this.getSetting('telegram_bot_token')).trim();
    const enabled = (await this.getSetting('telegram_bot_enabled')) === 'true';

    this.activeToken = token || null;
    this.isEnabled = Boolean(token && enabled);

    this.stopPolling();
    if (this.isEnabled && this.activeToken) {
      this.startPolling();
    }
  }

  async getConfigView(): Promise<TelegramBotConfigView> {
    const token = (await this.getSetting('telegram_bot_token')).trim();
    const enabled = (await this.getSetting('telegram_bot_enabled')) === 'true';
    const botId = (await this.getSetting('telegram_bot_id')).trim() || null;
    const botUsername = (await this.getSetting('telegram_bot_username')).trim() || null;
    const botName = (await this.getSetting('telegram_bot_name')).trim() || null;

    let masked: string | null = null;
    if (token.length > 10) {
      masked = `${token.slice(0, 6)}...${token.slice(-4)}`;
    } else if (token.length > 0) {
      masked = '****';
    }

    return {
      is_configured: Boolean(token),
      enabled: Boolean(token && enabled),
      polling_active: this.isPolling,
      bot_id: botId,
      bot_username: botUsername,
      bot_name: botName,
      token_masked: masked,
    };
  }

  /**
   * Super Admin token kiritganda: Telegram API (getMe) orqali tekshiradi,
   * bot ma'lumotlarini avtomatik bazaga saqlaydi va botni faollashtiradi.
   */
  async configureBot(token: string, enabled = true): Promise<TelegramBotConfigView> {
    const cleanToken = (token || '').trim();
    if (!cleanToken) {
      throw new BadRequestException('Telegram Bot tokenini kiriting');
    }

    let meData: TelegramGetMeResponse;
    try {
      const resp = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });
      meData = (await resp.json()) as TelegramGetMeResponse;
    } catch (err) {
      throw new BadRequestException(
        `Telegram serveriga ulanib bo'lmadi: ${(err as Error).message}`,
      );
    }

    if (!meData?.ok || !meData.result) {
      throw new BadRequestException(
        `Telegram Bot tokeni noto'g'ri: ${meData?.description || 'Unauthorized'}`,
      );
    }

    const bot = meData.result;
    await this.setSetting('telegram_bot_token', cleanToken, 'Telegram Bot API token');
    await this.setSetting(
      'telegram_bot_enabled',
      enabled ? 'true' : 'false',
      'Telegram Bot faol holati',
    );
    await this.setSetting('telegram_bot_id', String(bot.id), 'Telegram Bot ID');
    await this.setSetting('telegram_bot_username', bot.username || '', 'Telegram Bot username');
    await this.setSetting('telegram_bot_name', bot.first_name || '', 'Telegram Bot nomi');

    // Webhook mavjud bo'lsa o'chirib, long-pollingga tayyorlaymiz
    try {
      await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // ignore
    }

    await this.reloadFromSettings();
    this.logger.log(
      `Telegram Bot sozlandi va faollashtirildi: @${bot.username} (${bot.first_name})`,
    );
    return this.getConfigView();
  }

  async toggleBot(enabled: boolean): Promise<TelegramBotConfigView> {
    const token = (await this.getSetting('telegram_bot_token')).trim();
    if (enabled && !token) {
      throw new BadRequestException('Avval Telegram Bot tokenini kiriting');
    }
    await this.setSetting('telegram_bot_enabled', enabled ? 'true' : 'false');
    await this.reloadFromSettings();
    return this.getConfigView();
  }

  async removeBot(): Promise<TelegramBotConfigView> {
    this.stopPolling();
    await this.setSetting('telegram_bot_token', '');
    await this.setSetting('telegram_bot_enabled', 'false');
    await this.setSetting('telegram_bot_id', '');
    await this.setSetting('telegram_bot_username', '');
    await this.setSetting('telegram_bot_name', '');
    this.activeToken = null;
    this.isEnabled = false;
    return this.getConfigView();
  }

  async sendMessage(chatId: string, htmlText: string): Promise<boolean> {
    if (!this.isEnabled || !this.activeToken || !chatId) {
      return false;
    }

    try {
      const resp = await fetch(`https://api.telegram.org/bot${this.activeToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await resp.json()) as { ok?: boolean; description?: string };
      if (!data.ok) {
        this.logger.warn(`Telegram sendMessage xatosi (chat=${chatId}): ${data.description}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Telegram sendMessage tarmoq xatosi: ${(err as Error).message}`);
      return false;
    }
  }

  private startPolling(): void {
    if (this.isPolling || !this.activeToken) return;
    this.isPolling = true;
    this.logger.log('Telegram Bot long-polling ishga tushirildi');
    void this.pollLoop();
  }

  private stopPolling(): void {
    this.isPolling = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isPolling && this.activeToken) {
      try {
        this.pollAbortController = new AbortController();
        const url = `https://api.telegram.org/bot${this.activeToken}/getUpdates?timeout=25&offset=${this.lastUpdateId + 1}&allowed_updates=["message"]`;
        const resp = await fetch(url, { signal: this.pollAbortController.signal });
        const data = (await resp.json()) as { ok?: boolean; result?: TelegramUpdate[] };

        if (data.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            if (upd.update_id > this.lastUpdateId) {
              this.lastUpdateId = upd.update_id;
            }
            await this.handleUpdate(upd);
          }
        } else {
          await new Promise((r) => setTimeout(r, 4000));
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError' || !this.isPolling) {
          break;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handleUpdate(upd: TelegramUpdate): Promise<void> {
    const msg = upd.message;
    if (!msg?.text || !msg.chat?.id) return;

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();

    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const token = parts[1]?.trim();

      if (!token) {
        await this.sendMessage(
          chatId,
          `👋 <b>Arizalar Bazasi — Bildirishnoma Boti</b>\n\n` +
            `Hisobingizni ulash uchun tizimdagi <b>Mening Profilim</b> sahifasiga kirib, <b>"Telegramni ulash"</b> tugmasini bosing.`,
        );
        return;
      }

      const user = await this.userRepo.findOne({
        where: { telegram_link_token: token },
        relations: { auth: true },
      });

      if (!user) {
        await this.sendMessage(
          chatId,
          `❌ Bog'lash kodi noto'g'ri yoki allaqachon ishlatilgan. Tizimdan yangi havola oling.`,
        );
        return;
      }

      if (user.telegram_link_expires_at && user.telegram_link_expires_at.getTime() < Date.now()) {
        user.telegram_link_token = null;
        user.telegram_link_expires_at = null;
        await this.userRepo.save(user);
        await this.sendMessage(
          chatId,
          `⏳ Bog'lash havolasining muddati tugagan. Tizimdan yangi havola yarating.`,
        );
        return;
      }

      user.telegram_chat_id = chatId;
      user.telegram_username = msg.from?.username || msg.chat.username || null;
      user.telegram_first_name = msg.from?.first_name || msg.chat.first_name || null;
      user.telegram_link_token = null;
      user.telegram_link_expires_at = null;
      await this.userRepo.save(user);

      const fullName =
        [user.last_name, user.first_name].filter(Boolean).join(' ') ||
        user.auth?.username ||
        'Xodim';
      await this.sendMessage(
        chatId,
        `✅ <b>Muvaffaqiyatli ulandi!</b>\n\n` +
          `👤 Xodim: <b>${this.escapeHtml(fullName)}</b>\n` +
          `🛡 Rol: <code>${user.auth?.role || 'STAFF'}</code>\n\n` +
          `Endi muhim bildirishnomalar ushbu Telegram chatga avtomatik kelib turadi.`,
      );
      return;
    }

    if (text === '/status') {
      const user = await this.userRepo.findOne({
        where: { telegram_chat_id: chatId },
        relations: { auth: true },
      });
      if (user) {
        await this.sendMessage(
          chatId,
          `✅ Hisobingiz ulangan: <b>@${this.escapeHtml(user.auth?.username || '')}</b> (<code>${user.auth?.role || ''}</code>)`,
        );
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ Ushbu Telegram hisob tizimga ulanmagan. Tizimdagi <b>Mening Profilim</b> sahifasidan ulang.`,
        );
      }
    }
  }

  public escapeHtml(text: string): string {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
