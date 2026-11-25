import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AwarenessStatus } from './awareness-status.entity';
import { AwarenessStatusesController } from './awareness-statuses.controller';
import { AwarenessStatusesService } from './awareness-statuses.service';

@Module({
  imports: [TypeOrmModule.forFeature([AwarenessStatus])],
  controllers: [AwarenessStatusesController],
  providers: [AwarenessStatusesService],
  exports: [AwarenessStatusesService, TypeOrmModule],
})
export class AwarenessStatusesModule {}
