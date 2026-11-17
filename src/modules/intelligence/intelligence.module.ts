import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Application } from '../applications/application.entity';
import { Citizen } from '../applications/citizens/citizen.entity';
import { Bank } from '../applications/transfers/banks/bank.entity';
import { Card } from '../applications/transfers/cards/card.entity';
import { PaymentProvider } from '../applications/transfers/payment_providers/payment_provider.entity';
import { Transfer } from '../applications/transfers/transfer.entity';
import { AuthModule } from '../auth/auth.module';
import { FinancialFlowModule } from '../financial-flow/financial-flow.module';
import { User } from '../users/user.entity';
import { DigitalIdentifierEntity } from './entities/digital-identifier.entity';
import { EntityApplicationLink } from './entities/entity-application-link.entity';
import { PhoneEntity } from './entities/phone.entity';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './intelligence.service';
import { IntelligenceExportService } from './intelligence-export.service';
import { IntelligenceSyncService } from './intelligence-sync.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PhoneEntity,
      DigitalIdentifierEntity,
      EntityApplicationLink,
      Citizen,
      Card,
      Bank,
      PaymentProvider,
      Transfer,
      Application,
      User,
    ]),
    AuthModule,
    FinancialFlowModule,
  ],
  controllers: [IntelligenceController],
  providers: [IntelligenceSyncService, IntelligenceService, IntelligenceExportService],
  exports: [IntelligenceSyncService, IntelligenceService, IntelligenceExportService],
})
export class IntelligenceModule {}
