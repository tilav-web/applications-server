import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Application } from './modules/applications/application.entity';
import { ApplicationsModule } from './modules/applications/applications.module';
import { Citizen } from './modules/applications/citizens/citizen.entity';
import { Crime } from './modules/applications/crimes/crime.entity';
import { ApplicationCustomField } from './modules/applications/custom-fields/application-custom-field.entity';
import { District } from './modules/applications/districts/district.entity';
import { Mahalla } from './modules/applications/mahallas/mahalla.entity';
import { Bank } from './modules/applications/transfers/banks/bank.entity';
import { Card } from './modules/applications/transfers/cards/card.entity';
import { TransferCustomField } from './modules/applications/transfers/custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './modules/applications/transfers/payment_providers/payment_provider.entity';
import { Transfer } from './modules/applications/transfers/transfer.entity';
import { Auth } from './modules/auth/auth.entity';
import { AuthModule } from './modules/auth/auth.module';
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
          District,
          Mahalla,
          Transfer,
          TransferCustomField,
          Card,
          PaymentProvider,
          Bank,
        ],
        synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        autoLoadEntities: true,
      }),
    }),
    RedisModule,
    MinioModule,
    AuthModule,
    UsersModule,
    ApplicationsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
