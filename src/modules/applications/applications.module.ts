import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';
import { Application } from './application.entity';
import { ApplicationStatusHistory } from './application-status-history.entity';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationsRelationsService } from './applications-relations.service';
import { ApplicationsResolverService } from './applications-resolver.service';
import { ApplicationsStatisticsService } from './applications-statistics.service';
import { AwarenessStatus } from './awareness-statuses/awareness-status.entity';
import { AwarenessStatusesModule } from './awareness-statuses/awareness-statuses.module';
import { Citizen } from './citizens/citizen.entity';
import { CitizensModule } from './citizens/citizens.module';
import { Crime } from './crimes/crime.entity';
import { CrimesModule } from './crimes/crimes.module';
import { CrimeMethod } from './crimes/methods/crime-method.entity';
import { CrimeMethodsModule } from './crimes/methods/crime-methods.module';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { DecisionType } from './decision-types/decision-type.entity';
import { DecisionTypesModule } from './decision-types/decision-types.module';
import { DepartmentService } from './department-services/department-service.entity';
import { DepartmentServicesModule } from './department-services/department-services.module';
import { District } from './districts/district.entity';
import { DistrictsModule } from './districts/districts.module';
import { ApplicationDocument } from './documents/application-document.entity';
import { DocumentsModule } from './documents/documents.module';
import { ApplicationsExcelService } from './export/applications-excel.service';
import { CyberControlShablonExcelService } from './export/cybercontrol-shablon-excel.service';
import { ApplicationsImportController } from './import/applications-import.controller';
import { ApplicationsImportService } from './import/applications-import.service';
import { ApplicationsImportTemplateService } from './import/applications-import-template.service';
import { Neighborhood } from './neighborhoods/neighborhood.entity';
import { NeighborhoodsModule } from './neighborhoods/neighborhoods.module';
import { Occupation } from './occupations/occupation.entity';
import { OccupationCategory } from './occupations/occupation-category.entity';
import { OccupationsModule } from './occupations/occupations.module';
import { Region } from './regions/region.entity';
import { RegionsModule } from './regions/regions.module';
import { RejectionReason } from './rejection-reasons/rejection-reason.entity';
import { RejectionReasonsModule } from './rejection-reasons/rejection-reasons.module';
import { ApplicationsReportsController } from './reports/applications-reports.controller';
import { ApplicationsReportsService } from './reports/applications-reports.service';
import { ApplicationSource } from './sources/application-source.entity';
import { ApplicationSourcesModule } from './sources/sources.module';
import { ApplicationStatus } from './statuses/application-status.entity';
import { ApplicationStatusesModule } from './statuses/application-statuses.module';
import { SuspectFieldConfig } from './suspect-fields/suspect-field-config.entity';
import { SuspectFieldConfigsModule } from './suspect-fields/suspect-field-configs.module';
import { Bank } from './transfers/banks/bank.entity';
import { BanksModule } from './transfers/banks/banks.module';
import { Card } from './transfers/cards/card.entity';
import { CardsModule } from './transfers/cards/cards.module';
import { TransferChannelsModule } from './transfers/channels/transfer-channels.module';
import { TransferCustomField } from './transfers/custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './transfers/payment_providers/payment_provider.entity';
import { PaymentProvidersModule } from './transfers/payment_providers/payment-providers.module';
import { Transfer } from './transfers/transfer.entity';
import { TransfersModule } from './transfers/transfers.module';
import { Workplace } from './workplaces/workplace.entity';
import { WorkplacesModule } from './workplaces/workplaces.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Application,
      ApplicationStatusHistory,
      ApplicationCustomField,
      Citizen,
      Crime,
      CrimeMethod,
      Region,
      District,
      Neighborhood,
      Card,
      Transfer,
      Bank,
      PaymentProvider,
      TransferCustomField,
      ApplicationStatus,
      ApplicationDocument,
      SuspectFieldConfig,
      User,
      OccupationCategory,
      Occupation,
      ApplicationSource,
      AwarenessStatus,
      DepartmentService,
      RejectionReason,
      DecisionType,
      Workplace,
    ]),
    AuthModule,
    CitizensModule,
    CrimesModule,
    CrimeMethodsModule,
    RegionsModule,
    DistrictsModule,
    NeighborhoodsModule,
    ApplicationStatusesModule,
    AwarenessStatusesModule,
    SuspectFieldConfigsModule,
    BanksModule,
    PaymentProvidersModule,
    TransferChannelsModule,
    CardsModule,
    TransfersModule,
    DocumentsModule,
    OccupationsModule,
    ApplicationSourcesModule,
    DepartmentServicesModule,
    RejectionReasonsModule,
    DecisionTypesModule,
    WorkplacesModule,
  ],
  controllers: [
    ApplicationsImportController,
    ApplicationsController,
    ApplicationsReportsController,
  ],
  providers: [
    ApplicationsService,
    ApplicationsResolverService,
    ApplicationsRelationsService,
    ApplicationsStatisticsService,
    ApplicationsExcelService,
    CyberControlShablonExcelService,
    ApplicationsImportTemplateService,
    ApplicationsImportService,
    ApplicationsReportsService,
  ],
  exports: [
    ApplicationsService,
    ApplicationsResolverService,
    ApplicationsRelationsService,
    ApplicationsStatisticsService,
    ApplicationsExcelService,
    CyberControlShablonExcelService,
    ApplicationsImportTemplateService,
    ApplicationsImportService,
    ApplicationsReportsService,
    SuspectFieldConfigsModule,
    CrimeMethodsModule,
    OccupationsModule,
    ApplicationSourcesModule,
    DepartmentServicesModule,
    RejectionReasonsModule,
    DecisionTypesModule,
    WorkplacesModule,
    RegionsModule,
  ],
})
export class ApplicationsModule {}
