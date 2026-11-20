import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditLog } from './audit-log.entity';

export interface CreateAuditLogInput {
  user_id?: string | null;
  username?: string | null;
  role?: string | null;
  method: string;
  path: string;
  ip?: string | null;
  user_agent?: string | null;
  status_code: number;
  duration_ms: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(entry: CreateAuditLogInput): Promise<void> {
    try {
      const record = this.auditRepo.create({
        user_id: entry.user_id ?? null,
        username: entry.username ?? null,
        role: entry.role ?? null,
        method: entry.method.slice(0, 16),
        path: entry.path.slice(0, 512),
        ip: entry.ip ? entry.ip.slice(0, 64) : null,
        user_agent: entry.user_agent ? entry.user_agent.slice(0, 256) : null,
        status_code: entry.status_code,
        duration_ms: entry.duration_ms,
      });
      await this.auditRepo.save(record);
    } catch (err) {
      this.logger.warn(
        `Audit log yozishda xatolik: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
