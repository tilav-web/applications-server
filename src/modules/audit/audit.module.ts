import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { MinioModule } from '../minio/minio.module';
import { RedisModule } from '../redis/redis.module';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.entity';
import { IpBlockMiddleware } from './ip-block.middleware';
import { SecurityExceptionFilter } from './security-exception.filter';
import { SystemSetting } from './system-setting.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, SystemSetting]),
    ConfigModule,
    RedisModule,
    MinioModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor, IpBlockMiddleware, SecurityExceptionFilter],
  exports: [AuditService, AuditInterceptor, IpBlockMiddleware, SecurityExceptionFilter],
})
export class AuditModule {}
