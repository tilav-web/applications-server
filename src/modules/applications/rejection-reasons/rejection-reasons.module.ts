import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { RejectionReason } from './rejection-reason.entity';
import { RejectionReasonsController } from './rejection-reasons.controller';
import { RejectionReasonsService } from './rejection-reasons.service';

@Module({
  imports: [TypeOrmModule.forFeature([RejectionReason]), AuthModule],
  controllers: [RejectionReasonsController],
  providers: [RejectionReasonsService],
  exports: [RejectionReasonsService, TypeOrmModule],
})
export class RejectionReasonsModule {}
