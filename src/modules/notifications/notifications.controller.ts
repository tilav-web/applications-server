import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { type NotificationPrefs, NotificationsService } from './notifications.service';
import { TelegramBotService } from './telegram-bot.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly telegramBotService: TelegramBotService,
  ) {}

  @Get()
  getMine(
    @CurrentUser() user: JwtAccessPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.getMyNotifications(
      user.sub,
      Number(page) || 1,
      Math.min(Number(limit) || 20, 50),
    );
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markAsRead(user.sub, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: JwtAccessPayload) {
    return this.notificationsService.markAllAsRead(user.sub);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: JwtAccessPayload) {
    return this.notificationsService.getMyPreferences(user.sub);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: JwtAccessPayload,
    @Body() body: Partial<NotificationPrefs>,
  ) {
    return this.notificationsService.updateMyPreferences(user.sub, body);
  }

  @Post('telegram/link-token')
  generateTelegramLink(@CurrentUser() user: JwtAccessPayload) {
    return this.notificationsService.generateTelegramLink(user.sub);
  }

  @Delete('telegram/unlink')
  unlinkTelegram(@CurrentUser() user: JwtAccessPayload) {
    return this.notificationsService.unlinkTelegram(user.sub);
  }

  @Post('test')
  sendTest(@CurrentUser() user: JwtAccessPayload) {
    return this.notificationsService.sendTestNotification(user.sub);
  }

  // ===== SUPER ADMIN ENDPOINTS =====

  @Get('admin/settings')
  @Roles(Role.SUPER_ADMIN)
  getAdminSettings() {
    return this.notificationsService.getAdminSettings();
  }

  @Patch('admin/settings')
  @Roles(Role.SUPER_ADMIN)
  updateAdminRules(
    @Body()
    body: {
      high_value_threshold?: number;
      sla_days?: number;
      daily_digest_enabled?: boolean;
      daily_digest_hour?: number;
    },
  ) {
    return this.notificationsService.updateAdminRules(body);
  }

  @Post('admin/telegram/configure')
  @Roles(Role.SUPER_ADMIN)
  configureTelegramBot(@Body() body: { token: string; enabled?: boolean }) {
    return this.telegramBotService.configureBot(body.token, body.enabled ?? true);
  }

  @Post('admin/telegram/toggle')
  @Roles(Role.SUPER_ADMIN)
  toggleTelegramBot(@Body() body: { enabled: boolean }) {
    return this.telegramBotService.toggleBot(Boolean(body.enabled));
  }

  @Delete('admin/telegram')
  @Roles(Role.SUPER_ADMIN)
  removeTelegramBot() {
    return this.telegramBotService.removeBot();
  }

  @Post('admin/digest/send-now')
  @Roles(Role.SUPER_ADMIN)
  sendDigestNow() {
    return this.notificationsService.sendDailyDigest();
  }
}
