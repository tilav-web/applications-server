import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PassThrough } from 'stream';
import type { Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import type { MinioService } from '../minio/minio.service';
import type { RedisService } from '../redis/redis.service';
import { AuditService } from './audit.service';
import type { AuditLog } from './audit-log.entity';
import type { SystemSetting } from './system-setting.entity';

const ACTOR: JwtAccessPayload = {
  sub: 'super-1',
  username: 'superadmin',
  role: Role.SUPER_ADMIN,
};

function createMockQb(items: unknown[] = [], total = 0) {
  return {
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([items, total]),
    getMany: jest.fn().mockResolvedValue(items),
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let auditRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let settingsRepo: { find: jest.Mock; save: jest.Mock };
  let redisClient: {
    hset: jest.Mock;
    hdel: jest.Mock;
    hgetall: jest.Mock;
    mget: jest.Mock;
    zrevrange: jest.Mock;
    exists: jest.Mock;
    pipeline: jest.Mock;
  };
  let redisService: {
    getClient: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let minioService: { uploadBuffer: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    auditRepo = {
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
      find: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    };
    settingsRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
    };
    redisClient = {
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      mget: jest.fn().mockResolvedValue([]),
      zrevrange: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(0),
      pipeline: jest.fn(),
    };
    redisService = {
      getClient: jest.fn(() => redisClient),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    minioService = {
      uploadBuffer: jest.fn().mockResolvedValue({ key: 'audit-archives/a.json.gz', url: 'u' }),
    };
    configService = {
      get: jest.fn((key: string, def?: string) => (key === 'CROWDSEC_LAPI_KEY' ? '' : def)),
    };

    service = new AuditService(
      auditRepo as unknown as Repository<AuditLog>,
      settingsRepo as unknown as Repository<SystemSetting>,
      redisService as unknown as RedisService,
      minioService as unknown as MinioService,
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('IP blocking security', () => {
    it('never blocks localhost/loopback or empty/malformed IPs', async () => {
      expect(await service.isIpBlocked('127.0.0.1')).toBe(false);
      expect(await service.isIpBlocked('::ffff:127.0.0.1')).toBe(false);
      expect(await service.isIpBlocked('::1')).toBe(false);
      expect(redisService.get).not.toHaveBeenCalled();

      await expect(service.blockIp('127.0.0.1', 'test', 24, ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.blockIp('::ffff:127.0.0.1', 'test', 24, ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.blockIp('0.0.0.0', 'test', 24, ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.blockIp('not-an-ip*', 'test', 24, ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.unblockIp('   ', ACTOR)).rejects.toThrow(BadRequestException);
    });

    it('blocks valid IPv4/IPv6, strips ::ffff: prefix, clamps duration [1..720h], and logs audit event', async () => {
      const res = await service.blockIp('::ffff:185.12.34.56', 'Brute force', 9999, ACTOR);

      expect(res.success).toBe(true);
      expect(res.ip).toBe('185.12.34.56');
      expect(redisService.set).toHaveBeenCalledWith(
        'security:blocked_ip:185.12.34.56',
        'Brute force',
        720 * 3600,
      );
      expect(redisClient.hset).toHaveBeenCalledWith(
        'security:blocked_ips_meta',
        '185.12.34.56',
        expect.any(String),
      );
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'IP_BLOCKED', entity_id: '185.12.34.56' }),
      );
    });
  });

  describe('getLogs query safety', () => {
    it('escapes LIKE wildcards, ignores invalid dates without 500, and expands trimmed date_to to end-of-day', async () => {
      const qb = createMockQb([], 0);
      auditRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getLogs({
        page: -1,
        limit: 500,
        username: 'admin_%',
        ip: '10.0._%',
        search: '50%\\off',
        date_from: 'invalid-date-xyz',
        date_to: ' 2026-11-28 ',
      });

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(100);

      const calls = qb.andWhere.mock.calls as Array<[string, Record<string, unknown>]>;
      expect(calls.some(([sql]) => sql.includes('dateFrom'))).toBe(false);

      const dateToCall = calls.find(([sql]) => sql.includes('dateTo'));
      expect(dateToCall).toBeDefined();
      const endDate = dateToCall![1].dateTo as Date;
      expect(endDate.getHours()).toBe(23);
      expect(endDate.getMinutes()).toBe(59);
      expect(endDate.getSeconds()).toBe(59);

      const userCall = calls.find(([sql]) => sql.includes('log.username ILIKE'));
      expect(userCall![1].username).toBe('%admin\\_\\%%');
      const searchCall = calls.find(([sql]) => sql.includes(':term'));
      expect(searchCall![1].term).toBe('%50\\%\\\\off%');
    });
  });

  describe('retention policy & fail-safe archival', () => {
    it('rejects unsupported retention days and allows valid presets', async () => {
      await expect(service.updateSettings({ audit_retention_days: 15 }, ACTOR)).rejects.toThrow(
        BadRequestException,
      );

      settingsRepo.find.mockResolvedValue([
        { key: 'audit_retention_days', value: '180' },
        { key: 'audit_archive_to_minio', value: 'true' },
      ]);
      const updated = await service.updateSettings({ audit_retention_days: 180 }, ACTOR);
      expect(updated.audit_retention_days).toBe(180);
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUDIT_POLICY_UPDATED' }),
      );
    });

    it('NEVER deletes audit logs when MinIO archival fails (fail-safe data protection)', async () => {
      settingsRepo.find.mockResolvedValue([
        { key: 'audit_retention_days', value: '30' },
        { key: 'audit_archive_to_minio', value: 'true' },
      ]);
      auditRepo.find.mockResolvedValue([{ id: 'log-1' }, { id: 'log-2' }]);
      minioService.uploadBuffer.mockRejectedValueOnce(new Error('MinIO unreachable'));

      await expect(service.runRetentionCleanup(ACTOR)).rejects.toThrow(BadRequestException);
      expect(auditRepo.delete).not.toHaveBeenCalled();
    });

    it('uploads gzipped archive to MinIO and then deletes expired logs', async () => {
      settingsRepo.find.mockResolvedValue([
        { key: 'audit_retention_days', value: '90' },
        { key: 'audit_archive_to_minio', value: 'true' },
      ]);
      auditRepo.find.mockResolvedValue([{ id: 'log-1' }, { id: 'log-2' }]);

      const result = await service.runRetentionCleanup(ACTOR);

      expect(minioService.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^audit-archives\/audit_archive_.*\.json\.gz$/),
        'application/gzip',
        expect.stringMatching(/\.json\.gz$/),
      );
      expect(auditRepo.delete).toHaveBeenCalledWith(['log-1', 'log-2']);
      expect(result.deleted_count).toBe(2);
      expect(result.archived_key).toMatch(/^audit-archives\//);
    });
  });

  describe('exportLogsToExcel', () => {
    it('sanitizes Excel formula injection and handles null/invalid timestamps safely', async () => {
      const qb = createMockQb([
        {
          id: '1',
          created_at: null,
          username: '=CMD|calc',
          role: 'ADMIN',
          action: 'DELETE',
          severity: 'CRITICAL',
          entity_type: 'application',
          summary: '+SUM(1,2)',
          ip: '192.168.1.5',
          status_code: 200,
          method: 'DELETE',
          path: '/applications/1',
        },
      ]);
      auditRepo.createQueryBuilder.mockReturnValue(qb);

      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      const setHeader = jest.fn();
      const mockRes = Object.assign(stream, { setHeader }) as unknown as Response;

      await service.exportLogsToExcel({}, mockRes);

      expect(setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.concat(chunks) as never);
      const sheet = wb.getWorksheet('Audit Jurnali')!;
      // Columns: 1=№, 2=Vaqt, 3=Xodim, 8=Tavsif
      expect(sheet.getRow(2).getCell(3).value).toBe("'=CMD|calc");
      expect(sheet.getRow(2).getCell(8).value).toBe("'+SUM(1,2)");
      expect(sheet.getRow(2).getCell(2).value).toBe('—');
    });
  });

  describe('getTrafficOverview', () => {
    it('purges expired blocked IP metadata from Redis and gracefully reports unconfigured CrowdSec', async () => {
      redisClient.mget.mockResolvedValue(new Array(60).fill('2'));
      redisClient.hgetall
        .mockResolvedValueOnce({ total: '120', '2xx': '115', '4xx': '5', '403': '2' })
        .mockResolvedValueOnce({
          '1.2.3.4': JSON.stringify({
            ip: '1.2.3.4',
            reason: 'Active',
            blocked_by: 'admin',
            blocked_at: '',
            expires_at: '',
          }),
          '5.6.7.8': JSON.stringify({
            ip: '5.6.7.8',
            reason: 'Expired',
            blocked_by: 'admin',
            blocked_at: '',
            expires_at: '',
          }),
        });
      redisClient.zrevrange
        .mockResolvedValueOnce(['1.2.3.4', '50', '5.6.7.8', '10'])
        .mockResolvedValueOnce(['1.2.3.4', '4'])
        .mockResolvedValueOnce(['GET /applications', '40']);
      redisClient.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const overview = await service.getTrafficOverview();

      expect(redisClient.hdel).toHaveBeenCalledWith('security:blocked_ips_meta', '5.6.7.8');
      expect(overview.blocked_ips).toHaveLength(1);
      expect(overview.blocked_ips[0].ip).toBe('1.2.3.4');
      expect(overview.top_ips[0]).toEqual({
        ip: '1.2.3.4',
        requests: 50,
        errors: 4,
        is_blocked: true,
      });
      expect(overview.crowdsec.connected).toBe(false);
    });
  });
});
