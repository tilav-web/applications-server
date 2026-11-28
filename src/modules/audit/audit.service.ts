import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { isIP } from 'net';
import { LessThan, Repository } from 'typeorm';
import { gzipSync } from 'zlib';

import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import {
  applyExcelAutoFilter,
  sanitizeExcelRow,
  styleExcelDataRow,
  styleExcelHeaderRow,
} from '../../common/utils/excel-style.util';
import { escapeLikePattern } from '../../common/utils/normalization.util';
import { normalizePagination } from '../../common/utils/pagination.util';
import { MinioService } from '../minio/minio.service';
import { RedisService } from '../redis/redis.service';
import { AuditLog, type AuditSeverity } from './audit-log.entity';
import { SystemSetting } from './system-setting.entity';

export interface CreateAuditLogInput {
  user_id?: string | null;
  username?: string | null;
  role?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
  method: string;
  path: string;
  ip?: string | null;
  user_agent?: string | null;
  status_code: number;
  is_success: boolean;
  severity?: AuditSeverity;
  duration_ms: number;
}

export interface AuditLogQuery {
  page?: number | string;
  limit?: number | string;
  search?: string;
  action?: string;
  entity_type?: string;
  severity?: string;
  username?: string;
  ip?: string;
  is_success?: string;
  date_from?: string;
  date_to?: string;
}

export interface CrowdSecDecision {
  id?: number;
  origin?: string;
  type?: string;
  scope?: string;
  value?: string;
  duration?: string;
  scenario?: string;
}

const ALLOWED_RETENTION_DAYS = new Set([0, 30, 60, 90, 180, 365]);
const BLOCKED_IP_PREFIX = 'security:blocked_ip:';
const BLOCKED_IPS_META_KEY = 'security:blocked_ips_meta';

function normalizeEndpointPath(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d{4,}/g, '/:num');
}

function getMinuteKey(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 16); // YYYY-MM-DDTHH:MM
}

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private retentionTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(SystemSetting)
    private readonly settingsRepo: Repository<SystemSetting>,
    private readonly redisService: RedisService,
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    // Har 24 soatda muddati o'tgan audit loglarni avtomatik arxivlash va tozalash
    const oneDayMs = 24 * 60 * 60 * 1000;
    this.retentionTimer = setInterval(() => {
      void this.runRetentionCleanup();
    }, oneDayMs);
    this.retentionTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  async log(entry: CreateAuditLogInput): Promise<void> {
    try {
      const record = this.auditRepo.create({
        user_id: entry.user_id ?? null,
        username: entry.username ?? null,
        role: entry.role ?? null,
        action: entry.action.slice(0, 64),
        entity_type: entry.entity_type ? entry.entity_type.slice(0, 64) : null,
        entity_id: entry.entity_id ? entry.entity_id.slice(0, 128) : null,
        summary: entry.summary ? entry.summary.slice(0, 512) : null,
        details: entry.details ?? null,
        method: entry.method.slice(0, 16),
        path: entry.path.slice(0, 512),
        ip: entry.ip ? entry.ip.slice(0, 64) : null,
        user_agent: entry.user_agent ? entry.user_agent.slice(0, 256) : null,
        status_code: entry.status_code,
        is_success: entry.is_success,
        severity: entry.severity || 'INFO',
        duration_ms: entry.duration_ms,
      });
      await this.auditRepo.save(record);
    } catch (err) {
      this.logger.warn(
        `Audit log yozishda xatolik: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Har bir HTTP so'rov uchun Redis da yengil trafik statistikasi (PostgreSQL ga yuklama bermaydi)
   */
  async recordTraffic(ip: string, method: string, path: string, statusCode: number): Promise<void> {
    const client = this.redisService.getClient();
    if (!client) return;

    try {
      const minuteKey = `traffic:rpm:${getMinuteKey(new Date())}`;
      const normalizedEndpoint = `${method} ${normalizeEndpointPath(path)}`;
      const cleanIp = ip.replace(/^::ffff:/, '') || 'unknown';

      const pipeline = client.pipeline();
      pipeline.incr(minuteKey);
      pipeline.expire(minuteKey, 7200); // 2 soat

      pipeline.hincrby('traffic:status', 'total', 1);
      if (statusCode >= 200 && statusCode < 300) {
        pipeline.hincrby('traffic:status', '2xx', 1);
      } else if (statusCode >= 300 && statusCode < 400) {
        pipeline.hincrby('traffic:status', '3xx', 1);
      } else if (statusCode >= 400 && statusCode < 500) {
        pipeline.hincrby('traffic:status', '4xx', 1);
        if (statusCode === 401) pipeline.hincrby('traffic:status', '401', 1);
        if (statusCode === 403) pipeline.hincrby('traffic:status', '403', 1);
        if (statusCode === 429) pipeline.hincrby('traffic:status', '429', 1);
      } else if (statusCode >= 500) {
        pipeline.hincrby('traffic:status', '5xx', 1);
      }
      pipeline.expire('traffic:status', 86400);

      pipeline.zincrby('traffic:ip:hits', 1, cleanIp);
      pipeline.expire('traffic:ip:hits', 86400);

      if (statusCode >= 400) {
        pipeline.zincrby('traffic:ip:errors', 1, cleanIp);
        pipeline.expire('traffic:ip:errors', 86400);
      }

      pipeline.zincrby('traffic:endpoints', 1, normalizedEndpoint);
      pipeline.expire('traffic:endpoints', 86400);

      await pipeline.exec();
    } catch {
      // Trafik telemetriyasi asosiy so'rovni hech qachon to'xtatmasligi kerak
    }
  }

  async isIpBlocked(ip: string | null | undefined): Promise<boolean> {
    if (!ip) return false;
    const cleanIp = ip.replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1') return false;
    const val = await this.redisService.get(`${BLOCKED_IP_PREFIX}${cleanIp}`);
    return val !== null;
  }

  async blockIp(
    ip: string,
    reason: string,
    durationHours: number,
    actor: JwtAccessPayload,
  ): Promise<{ success: boolean; ip: string; expires_at: string }> {
    const cleanIp = (ip || '').trim().replace(/^::ffff:/, '');
    if (
      !cleanIp ||
      cleanIp === '127.0.0.1' ||
      cleanIp === '::1' ||
      cleanIp === '0.0.0.0' ||
      cleanIp.toLowerCase() === 'localhost'
    ) {
      throw new BadRequestException("Localhost yoki bo'sh IP manzilni bloklab bo'lmaydi");
    }
    if (isIP(cleanIp) === 0) {
      throw new BadRequestException("Yaroqsiz IP manzil formati (IPv4 yoki IPv6 bo'lishi kerak)");
    }

    const safeHours = Math.min(Math.max(Number(durationHours) || 24, 1), 720); // 1 soatdan 30 kungacha
    const ttlSeconds = safeHours * 3600;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    await this.redisService.set(
      `${BLOCKED_IP_PREFIX}${cleanIp}`,
      reason || 'Admin blokladi',
      ttlSeconds,
    );

    const client = this.redisService.getClient();
    if (client) {
      await client.hset(
        BLOCKED_IPS_META_KEY,
        cleanIp,
        JSON.stringify({
          ip: cleanIp,
          reason: reason || 'Super Admin tomonidan bloklandi',
          blocked_by: actor.username,
          blocked_at: new Date().toISOString(),
          expires_at: expiresAt,
        }),
      );
    }

    await this.log({
      user_id: actor.sub,
      username: actor.username,
      role: actor.role,
      action: 'IP_BLOCKED',
      entity_type: 'security',
      entity_id: cleanIp,
      summary: `${cleanIp} IP manzili ${safeHours} soatga bloklandi`,
      details: { ip: cleanIp, reason, duration_hours: safeHours, expires_at: expiresAt },
      method: 'POST',
      path: '/audit/traffic/block-ip',
      status_code: 200,
      is_success: true,
      severity: 'WARNING',
      duration_ms: 0,
    });

    return { success: true, ip: cleanIp, expires_at: expiresAt };
  }

  async unblockIp(ip: string, actor: JwtAccessPayload): Promise<{ success: boolean; ip: string }> {
    const cleanIp = (ip || '').trim().replace(/^::ffff:/, '');
    if (!cleanIp) {
      throw new BadRequestException("IP manzil bo'sh bo'lishi mumkin emas");
    }
    await this.redisService.del(`${BLOCKED_IP_PREFIX}${cleanIp}`);

    const client = this.redisService.getClient();
    if (client) {
      await client.hdel(BLOCKED_IPS_META_KEY, cleanIp);
    }

    await this.log({
      user_id: actor.sub,
      username: actor.username,
      role: actor.role,
      action: 'IP_UNBLOCKED',
      entity_type: 'security',
      entity_id: cleanIp,
      summary: `${cleanIp} IP manzili blokdan chiqarildi`,
      details: { ip: cleanIp },
      method: 'DELETE',
      path: `/audit/traffic/block-ip/${cleanIp}`,
      status_code: 200,
      is_success: true,
      severity: 'INFO',
      duration_ms: 0,
    });

    return { success: true, ip: cleanIp };
  }

  private buildLogsQuery(q: AuditLogQuery) {
    const qb = this.auditRepo.createQueryBuilder('log').orderBy('log.created_at', 'DESC');

    if (q.action?.trim()) {
      qb.andWhere('log.action = :action', { action: q.action.trim() });
    }
    if (q.entity_type?.trim()) {
      qb.andWhere('log.entity_type = :entityType', { entityType: q.entity_type.trim() });
    }
    if (q.severity?.trim()) {
      qb.andWhere('log.severity = :severity', { severity: q.severity.trim() });
    }
    if (q.username?.trim()) {
      qb.andWhere('log.username ILIKE :username', {
        username: `%${escapeLikePattern(q.username.trim())}%`,
      });
    }
    if (q.ip?.trim()) {
      qb.andWhere('log.ip ILIKE :ip', { ip: `%${escapeLikePattern(q.ip.trim())}%` });
    }
    if (q.is_success === 'true' || q.is_success === 'false') {
      qb.andWhere('log.is_success = :isSuccess', { isSuccess: q.is_success === 'true' });
    }
    if (q.date_from?.trim()) {
      const start = new Date(q.date_from.trim());
      if (!Number.isNaN(start.getTime())) {
        qb.andWhere('log.created_at >= :dateFrom', { dateFrom: start });
      }
    }
    if (q.date_to?.trim()) {
      const rawTo = q.date_to.trim();
      const end = new Date(rawTo);
      if (!Number.isNaN(end.getTime())) {
        if (rawTo.length <= 10) {
          end.setHours(23, 59, 59, 999);
        }
        qb.andWhere('log.created_at <= :dateTo', { dateTo: end });
      }
    }
    if (q.search?.trim()) {
      const term = `%${escapeLikePattern(q.search.trim())}%`;
      qb.andWhere(
        '(log.username ILIKE :term OR log.summary ILIKE :term OR log.path ILIKE :term OR log.ip ILIKE :term OR log.action ILIKE :term OR log.entity_id ILIKE :term)',
        { term },
      );
    }

    return qb;
  }

  async getLogs(q: AuditLogQuery) {
    const { page, limit } = normalizePagination(q.page, q.limit, 25, 100);
    const qb = this.buildLogsQuery(q);
    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getStats() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [totalLogs, todayCount, failedAuth24h, exports24h, deletes24h, critical24h] =
      await Promise.all([
        this.auditRepo.count(),
        this.auditRepo
          .createQueryBuilder('l')
          .where('l.created_at >= :startOfDay', { startOfDay })
          .getCount(),
        this.auditRepo
          .createQueryBuilder('l')
          .where('l.created_at >= :last24h', { last24h })
          .andWhere('(l.action = :lf OR l.status_code IN (401, 403, 429))', {
            lf: 'LOGIN_FAILED',
          })
          .getCount(),
        this.auditRepo
          .createQueryBuilder('l')
          .where('l.created_at >= :last24h', { last24h })
          .andWhere('l.action LIKE :exp', { exp: 'EXPORT%' })
          .getCount(),
        this.auditRepo
          .createQueryBuilder('l')
          .where('l.created_at >= :last24h', { last24h })
          .andWhere('l.action = :del', { del: 'DELETE' })
          .getCount(),
        this.auditRepo
          .createQueryBuilder('l')
          .where('l.created_at >= :last24h', { last24h })
          .andWhere('l.severity = :crit', { crit: 'CRITICAL' })
          .getCount(),
      ]);

    return {
      total_logs: totalLogs,
      today_count: todayCount,
      failed_auth_24h: failedAuth24h,
      exports_24h: exports24h,
      deletes_24h: deletes24h,
      critical_24h: critical24h,
    };
  }

  async getSettings(): Promise<{
    audit_retention_days: number;
    audit_archive_to_minio: boolean;
  }> {
    const rows = await this.settingsRepo.find();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const retentionRaw = Number(map.get('audit_retention_days') ?? '90');
    const archiveRaw = map.get('audit_archive_to_minio') ?? 'true';

    return {
      audit_retention_days: Number.isFinite(retentionRaw) ? retentionRaw : 90,
      audit_archive_to_minio: archiveRaw === 'true',
    };
  }

  async updateSettings(
    dto: { audit_retention_days?: number; audit_archive_to_minio?: boolean },
    actor: JwtAccessPayload,
  ) {
    const before = await this.getSettings();

    if (dto.audit_retention_days !== undefined) {
      const days = Number(dto.audit_retention_days);
      if (!ALLOWED_RETENTION_DAYS.has(days)) {
        throw new BadRequestException(
          'Saqlash muddati faqat 0 (cheksiz), 30, 60, 90, 180 yoki 365 kun bo‘lishi mumkin',
        );
      }
      await this.settingsRepo.save({
        key: 'audit_retention_days',
        value: String(days),
        description: 'Audit loglarni avtomatik saqlash muddati (kunlarda, 0 = cheksiz)',
      });
    }

    if (dto.audit_archive_to_minio !== undefined) {
      await this.settingsRepo.save({
        key: 'audit_archive_to_minio',
        value: String(Boolean(dto.audit_archive_to_minio)),
        description: 'Tozalashdan oldin eski audit loglarni MinIO ga arxivlash',
      });
    }

    const after = await this.getSettings();

    await this.log({
      user_id: actor.sub,
      username: actor.username,
      role: actor.role,
      action: 'AUDIT_POLICY_UPDATED',
      entity_type: 'security',
      summary: `Audit saqlash siyosati yangilandi: ${after.audit_retention_days === 0 ? 'Cheksiz' : `${after.audit_retention_days} kun`}`,
      details: { before, after },
      method: 'PATCH',
      path: '/audit/settings',
      status_code: 200,
      is_success: true,
      severity: 'WARNING',
      duration_ms: 0,
    });

    return after;
  }

  async runRetentionCleanup(actor?: JwtAccessPayload): Promise<{
    deleted_count: number;
    archived_key: string | null;
    retention_days: number;
  }> {
    const { audit_retention_days, audit_archive_to_minio } = await this.getSettings();
    if (!audit_retention_days || audit_retention_days <= 0) {
      return { deleted_count: 0, archived_key: null, retention_days: 0 };
    }

    const cutoff = new Date(Date.now() - audit_retention_days * 24 * 60 * 60 * 1000);
    const oldLogs = await this.auditRepo.find({
      where: { created_at: LessThan(cutoff) },
      order: { created_at: 'ASC' },
      take: 10000,
    });

    if (oldLogs.length === 0) {
      return { deleted_count: 0, archived_key: null, retention_days: audit_retention_days };
    }

    let archivedKey: string | null = null;
    if (audit_archive_to_minio) {
      try {
        const jsonBuf = Buffer.from(JSON.stringify(oldLogs), 'utf8');
        const gzBuf = gzipSync(jsonBuf);
        const dateTag = new Date().toISOString().slice(0, 10);
        const fileName = `audit_archive_${dateTag}_${Date.now()}.json.gz`;
        const key = `audit-archives/${fileName}`;
        await this.minioService.uploadBuffer(gzBuf, key, 'application/gzip', fileName);
        archivedKey = key;
      } catch (err) {
        this.logger.error('Audit loglarni MinIO ga arxivlashda xatolik:', err);
        throw new BadRequestException(
          'MinIO ga arxivlash muvaffaqiyatsiz bo‘ldi, loglar xavfsizlik sababli o‘chirilmadi',
        );
      }
    }

    const ids = oldLogs.map((l) => l.id);
    await this.auditRepo.delete(ids);

    await this.log({
      user_id: actor?.sub ?? null,
      username: actor?.username ?? 'SYSTEM_CRON',
      role: actor?.role ?? 'SYSTEM',
      action: 'AUDIT_CLEANUP',
      entity_type: 'security',
      summary: `${oldLogs.length} ta eski audit yozuvi tozalandi (${audit_retention_days} kundan eski)`,
      details: {
        deleted_count: oldLogs.length,
        retention_days: audit_retention_days,
        archived_key: archivedKey,
      },
      method: 'POST',
      path: '/audit/cleanup',
      status_code: 200,
      is_success: true,
      severity: 'WARNING',
      duration_ms: 0,
    });

    return {
      deleted_count: oldLogs.length,
      archived_key: archivedKey,
      retention_days: audit_retention_days,
    };
  }

  async exportLogsToExcel(q: AuditLogQuery, res: Response): Promise<void> {
    const qb = this.buildLogsQuery(q);
    qb.take(5000);
    const logs = await qb.getMany();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Audit Jurnali', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Vaqt', key: 'created_at', width: 20 },
      { header: 'Xodim', key: 'username', width: 18 },
      { header: 'Rol', key: 'role', width: 16 },
      { header: 'Harakat', key: 'action', width: 22 },
      { header: 'Daraja', key: 'severity', width: 15 },
      { header: "Bo'lim", key: 'entity_type', width: 18 },
      { header: 'Tavsif', key: 'summary', width: 45 },
      { header: 'IP Manzil', key: 'ip', width: 18 },
      { header: 'Status', key: 'status_code', width: 10 },
      { header: "Yo'l (Path)", key: 'path', width: 35 },
    ];

    styleExcelHeaderRow(sheet.getRow(1));
    applyExcelAutoFilter(sheet, 1);

    const severityMap: Record<string, string> = {
      INFO: "Ma'lumot",
      WARN: 'Ogohlantirish',
      WARNING: 'Ogohlantirish',
      ERROR: 'Xatolik',
      CRITICAL: 'Kritik',
    };

    logs.forEach((log, idx) => {
      const createdDate = log.created_at ? new Date(log.created_at) : null;
      const formattedCreatedAt =
        createdDate && !Number.isNaN(createdDate.getTime())
          ? createdDate.toISOString().slice(0, 19).replace('T', ' ')
          : '—';
      const row = sheet.addRow(
        sanitizeExcelRow({
          idx: idx + 1,
          created_at: formattedCreatedAt,
          username: log.username || 'Anonim',
          role: log.role || '—',
          action: log.action,
          severity: severityMap[(log.severity || '').toUpperCase()] || log.severity || '—',
          entity_type: log.entity_type || '—',
          summary: log.summary || '—',
          ip: log.ip || '—',
          status_code: log.status_code,
          path: `${log.method} ${log.path}`,
        }),
      );
      styleExcelDataRow(row, ['summary']);
      row.getCell('ip').numFmt = '@';
      row.getCell('status_code').alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const fileName = `audit_jurnal_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  private async fetchCrowdSecDecisions(): Promise<{
    connected: boolean;
    decisions: CrowdSecDecision[];
    error?: string;
  }> {
    const lapiUrl = this.configService.get<string>(
      'CROWDSEC_LAPI_URL',
      'http://uvd_app_crowdsec:8080',
    );
    const apiKey = this.configService.get<string>('CROWDSEC_LAPI_KEY', '');

    if (!apiKey) {
      return {
        connected: false,
        decisions: [],
        error: 'CROWDSEC_LAPI_KEY sozlanmagan',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${lapiUrl}/v1/decisions`, {
        headers: { 'X-Api-Key': apiKey },
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          connected: false,
          decisions: [],
          error: `CrowdSec LAPI HTTP ${response.status}`,
        };
      }

      const raw = (await response.json()) as CrowdSecDecision[] | null;
      return {
        connected: true,
        decisions: Array.isArray(raw) ? raw : [],
      };
    } catch (err) {
      return {
        connected: false,
        decisions: [],
        error: err instanceof Error ? err.message : 'CrowdSec ulanmadi',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getTrafficOverview() {
    const client = this.redisService.getClient();
    const now = new Date();

    // Oxirgi 60 daqiqa uchun RPM timeline
    const timelineKeys: { label: string; key: string }[] = [];
    for (let i = 59; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60_000);
      const isoMin = getMinuteKey(d);
      timelineKeys.push({
        label: isoMin.slice(11, 16), // HH:MM
        key: `traffic:rpm:${isoMin}`,
      });
    }

    let timeline = timelineKeys.map((t) => ({ time: t.label, requests: 0 }));
    let statusBreakdown = {
      total: 0,
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '401': 0,
      '403': 0,
      '429': 0,
      '5xx': 0,
    };
    const topIps: { ip: string; requests: number; errors: number; is_blocked: boolean }[] = [];
    const topEndpoints: { endpoint: string; requests: number }[] = [];
    let blockedIps: Array<{
      ip: string;
      reason: string;
      blocked_by: string;
      blocked_at: string;
      expires_at: string;
    }> = [];

    if (client) {
      try {
        const rpmValues = await client.mget(timelineKeys.map((t) => t.key));
        timeline = timelineKeys.map((t, idx) => ({
          time: t.label,
          requests: Number(rpmValues[idx] || 0),
        }));

        const rawStatus = await client.hgetall('traffic:status');
        statusBreakdown = {
          total: Number(rawStatus.total || 0),
          '2xx': Number(rawStatus['2xx'] || 0),
          '3xx': Number(rawStatus['3xx'] || 0),
          '4xx': Number(rawStatus['4xx'] || 0),
          '401': Number(rawStatus['401'] || 0),
          '403': Number(rawStatus['403'] || 0),
          '429': Number(rawStatus['429'] || 0),
          '5xx': Number(rawStatus['5xx'] || 0),
        };

        const [rawIps, rawErrorIps, rawEndpoints, rawBlockedMeta] = await Promise.all([
          client.zrevrange('traffic:ip:hits', 0, 14, 'WITHSCORES'),
          client.zrevrange('traffic:ip:errors', 0, 49, 'WITHSCORES'),
          client.zrevrange('traffic:endpoints', 0, 14, 'WITHSCORES'),
          client.hgetall(BLOCKED_IPS_META_KEY),
        ]);

        const errorMap = new Map<string, number>();
        for (let i = 0; i < rawErrorIps.length; i += 2) {
          errorMap.set(rawErrorIps[i], Number(rawErrorIps[i + 1] || 0));
        }

        const activeBlockedSet = new Set<string>();
        const parsedBlocked: typeof blockedIps = [];
        for (const [ipKey, rawVal] of Object.entries(rawBlockedMeta)) {
          const stillActive = await client.exists(`${BLOCKED_IP_PREFIX}${ipKey}`);
          if (stillActive) {
            activeBlockedSet.add(ipKey);
            try {
              parsedBlocked.push(JSON.parse(rawVal) as (typeof blockedIps)[number]);
            } catch {
              parsedBlocked.push({
                ip: ipKey,
                reason: 'Bloklangan',
                blocked_by: 'admin',
                blocked_at: '',
                expires_at: '',
              });
            }
          } else {
            await client.hdel(BLOCKED_IPS_META_KEY, ipKey);
          }
        }
        blockedIps = parsedBlocked;

        for (let i = 0; i < rawIps.length; i += 2) {
          const ipAddr = rawIps[i];
          topIps.push({
            ip: ipAddr,
            requests: Number(rawIps[i + 1] || 0),
            errors: errorMap.get(ipAddr) || 0,
            is_blocked: activeBlockedSet.has(ipAddr),
          });
        }

        for (let i = 0; i < rawEndpoints.length; i += 2) {
          topEndpoints.push({
            endpoint: rawEndpoints[i],
            requests: Number(rawEndpoints[i + 1] || 0),
          });
        }
      } catch (err) {
        this.logger.warn(
          `Redis trafik statistikasini o'qishda xatolik: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const crowdsec = await this.fetchCrowdSecDecisions();

    return {
      timeline,
      status_breakdown: statusBreakdown,
      top_ips: topIps,
      top_endpoints: topEndpoints,
      blocked_ips: blockedIps,
      crowdsec,
    };
  }
}
