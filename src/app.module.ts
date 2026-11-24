import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AuditModule } from './modules/audit/audit.module';
import { IpBlockMiddleware } from './modules/audit/ip-block.middleware';
import { SecurityExceptionFilter } from './modules/audit/security-exception.filter';
import { AuthModule } from './modules/auth/auth.module';
import { DetectedCrimesModule } from './modules/detected-crimes/detected-crimes.module';
import { FinancialFlowModule } from './modules/financial-flow/financial-flow.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { MinioModule } from './modules/minio/minio.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RedisModule } from './modules/redis/redis.module';
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
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        const dbPassword = config.get<string>('DB_PASSWORD');
        if (isProduction && (!dbPassword || dbPassword === 'postgres_password_2026')) {
          throw new Error(
            'XAVFSIZLIK XATOLIGI: Production muhitida DB_PASSWORD kuchli maxfiy qiymat bilan sozlanishi shart!',
          );
        }

        const synchronize =
          !isProduction && config.get<string>('DB_SYNCHRONIZE', 'false') === 'true';
        return {
          type: 'postgres',
          host: config.get<string>('DB_HOST', 'localhost'),
          port: parseInt(config.get<string>('DB_PORT', '5434'), 10),
          username: config.get<string>('DB_USERNAME', 'postgres'),
          password: dbPassword || 'postgres_password_2026',
          database: config.get<string>('DB_NAME', 'uvd_app_db'),
          autoLoadEntities: true,
          synchronize,
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          migrationsRun: true,
          extra: {
            max: parseInt(config.get<string>('DB_POOL_MAX', '25'), 10),
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
            statement_timeout: 30000,
          },
        };
      },
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
    AuditModule,
    NotificationsModule,
    UsersModule,
    ApplicationsModule,
    DetectedCrimesModule,
    FinancialFlowModule,
    IntelligenceModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: SecurityExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IpBlockMiddleware).forRoutes('*');
  }
}
