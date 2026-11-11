import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { Application } from './modules/applications/application.entity';
import { ApplicationsModule } from './modules/applications/applications.module';
import { Citizen } from './modules/applications/citizens/citizen.entity';
import { Crime } from './modules/applications/crimes/crime.entity';
import { CrimeMethod } from './modules/applications/crimes/methods/crime-method.entity';
import { ApplicationCustomField } from './modules/applications/custom-fields/application-custom-field.entity';
import { DecisionType } from './modules/applications/decision-types/decision-type.entity';
import { DepartmentService } from './modules/applications/department-services/department-service.entity';
import { District } from './modules/applications/districts/district.entity';
import { ApplicationDocument } from './modules/applications/documents/application-document.entity';
import { DocumentTemplate } from './modules/applications/documents/templates/document-template.entity';
import { Mahalla } from './modules/applications/mahallas/mahalla.entity';
import { Occupation } from './modules/applications/occupations/occupation.entity';
import { OccupationCategory } from './modules/applications/occupations/occupation-category.entity';
import { RejectionReason } from './modules/applications/rejection-reasons/rejection-reason.entity';
import { ApplicationSource } from './modules/applications/sources/application-source.entity';
import { Bank } from './modules/applications/transfers/banks/bank.entity';
import { Card } from './modules/applications/transfers/cards/card.entity';
import { TransferCustomField } from './modules/applications/transfers/custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './modules/applications/transfers/payment_providers/payment_provider.entity';
import { Transfer } from './modules/applications/transfers/transfer.entity';
import { Auth } from './modules/auth/auth.entity';
import { AuthModule } from './modules/auth/auth.module';
import { FinancialFlowModule } from './modules/financial-flow/financial-flow.module';
import { MinioModule } from './modules/minio/minio.module';
import { RedisModule } from './modules/redis/redis.module';
import { User } from './modules/users/user.entity';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: parseInt(config.get<string>('DB_PORT', '5434'), 10),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres_password_2026'),
        database: config.get<string>('DB_NAME', 'uvd_app_db'),
        entities: [
          Auth,
          User,
          Application,
          ApplicationCustomField,
          Citizen,
          Crime,
          CrimeMethod,
          District,
          Mahalla,
          Transfer,
          TransferCustomField,
          Card,
          PaymentProvider,
          Bank,
          ApplicationDocument,
          DocumentTemplate,
          OccupationCategory,
          Occupation,
          ApplicationSource,
          DepartmentService,
          RejectionReason,
          DecisionType,
        ],
        synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        autoLoadEntities: true,
      }),
    }),
    RedisModule,
    MinioModule,
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 15, // Sekundiga 15 ta so'rov (burst protection)
      },
      {
        name: 'default',
        ttl: 60000,
        limit: 120, // Daqiqasiga 120 ta so'rov (umumiy API)
      },
    ]),
    AuthModule,
    UsersModule,
    ApplicationsModule,
    FinancialFlowModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
