import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { SuspectFieldConfig } from './suspect-field-config.entity';
import { SuspectFieldConfigsController } from './suspect-field-configs.controller';
import { SuspectFieldConfigsService } from './suspect-field-configs.service';

@Module({
  imports: [TypeOrmModule.forFeature([SuspectFieldConfig]), AuthModule],
  controllers: [SuspectFieldConfigsController],
  providers: [SuspectFieldConfigsService],
  exports: [SuspectFieldConfigsService],
})
export class SuspectFieldConfigsModule {}
