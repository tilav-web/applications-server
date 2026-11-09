import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { Application } from '../application.entity';
import { ApplicationStatus } from './application-status.entity';
import { ApplicationStatusesController } from './application-statuses.controller';
import { ApplicationStatusesService } from './application-statuses.service';

@Module({
  imports: [TypeOrmModule.forFeature([ApplicationStatus, Application]), AuthModule],
  controllers: [ApplicationStatusesController],
  providers: [ApplicationStatusesService],
  exports: [ApplicationStatusesService],
})
export class ApplicationStatusesModule {}

