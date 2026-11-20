import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
