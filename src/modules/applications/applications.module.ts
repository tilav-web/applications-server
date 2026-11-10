import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Application } from './application.entity';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { Citizen } from './citizens/citizen.entity';
import { CitizensModule } from './citizens/citizens.module';
import { Crime } from './crimes/crime.entity';
import { CrimesModule } from './crimes/crimes.module';
import { CrimeMethod } from './crimes/methods/crime-method.entity';
import { CrimeMethodsModule } from './crimes/methods/crime-methods.module';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { District } from './districts/district.entity';
import { DistrictsModule } from './districts/districts.module';
import { ApplicationDocument } from './documents/application-document.entity';
import { DocumentsModule } from './documents/documents.module';
import { ApplicationsExcelService } from './export/applications-excel.service';
import { Mahalla } from './mahallas/mahalla.entity';
import { MahallasModule } from './mahallas/mahallas.module';
import { ApplicationsReportsController } from './reports/applications-reports.controller';
import { ApplicationsReportsService } from './reports/applications-reports.service';
import { ApplicationStatus } from './statuses/application-status.entity';
import { ApplicationStatusesModule } from './statuses/application-statuses.module';
import { SuspectFieldConfig } from './suspect-fields/suspect-field-config.entity';
import { SuspectFieldConfigsModule } from './suspect-fields/suspect-field-configs.module';
import { Bank } from './transfers/banks/bank.entity';
import { BanksModule } from './transfers/banks/banks.module';
import { Card } from './transfers/cards/card.entity';
import { CardsModule } from './transfers/cards/cards.module';
import { TransferCustomField } from './transfers/custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './transfers/payment_providers/payment_provider.entity';
import { PaymentProvidersModule } from './transfers/payment_providers/payment-providers.module';
import { Transfer } from './transfers/transfer.entity';
import { TransfersModule } from './transfers/transfers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Application,
      ApplicationCustomField,
      Citizen,
      Crime,
      CrimeMethod,
      District,
      Mahalla,
      Card,
      Transfer,
      Bank,
      PaymentProvider,
      TransferCustomField,
      ApplicationStatus,
      ApplicationDocument,
      SuspectFieldConfig,
    ]),
    AuthModule,
    CitizensModule,
    CrimesModule,
    CrimeMethodsModule,
    DistrictsModule,
    MahallasModule,
    ApplicationStatusesModule,
    SuspectFieldConfigsModule,
    BanksModule,
    PaymentProvidersModule,
    CardsModule,
    TransfersModule,
    DocumentsModule,
  ],
  controllers: [ApplicationsController, ApplicationsReportsController],
  providers: [ApplicationsService, ApplicationsExcelService, ApplicationsReportsService],
  exports: [
    ApplicationsService,
    ApplicationsExcelService,
    ApplicationsReportsService,
    SuspectFieldConfigsModule,
    CrimeMethodsModule,
  ],
})
export class ApplicationsModule {}
