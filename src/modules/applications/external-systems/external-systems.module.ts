import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { ApplicationExternalSystem } from './application-external-system.entity';
import { ExternalSystem } from './external-system.entity';
import { ExternalSystemsController } from './external-systems.controller';
import { ExternalSystemsService } from './external-systems.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExternalSystem, ApplicationExternalSystem]), AuthModule],
  controllers: [ExternalSystemsController],
  providers: [ExternalSystemsService],
  exports: [ExternalSystemsService, TypeOrmModule],
})
export class ExternalSystemsModule {}
