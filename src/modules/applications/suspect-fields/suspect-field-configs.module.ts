import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SuspectFieldConfig } from './suspect-field-config.entity';
import { SuspectFieldConfigsController } from './suspect-field-configs.controller';
import { SuspectFieldConfigsService } from './suspect-field-configs.service';

@Module({
  imports: [TypeOrmModule.forFeature([SuspectFieldConfig])],
  controllers: [SuspectFieldConfigsController],
  providers: [SuspectFieldConfigsService],
  exports: [SuspectFieldConfigsService],
})
export class SuspectFieldConfigsModule {}
