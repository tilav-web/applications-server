import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Application } from '../applications/application.entity';
import { SystemSetting } from '../audit/system-setting.entity';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';
import { Notification } from './notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SlaQueueService } from './sla-queue.service';
import { TelegramBotService } from './telegram-bot.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification, User, SystemSetting, Application]), AuthModule],
  controllers: [NotificationsController],
  providers: [TelegramBotService, NotificationsService, SlaQueueService],
  exports: [TelegramBotService, NotificationsService, SlaQueueService],
})
export class NotificationsModule {}
