import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Readable } from 'stream';
import type { Repository } from 'typeorm';

import { Role } from '../../../common/enums/role.enum';
import type { DetectedCrime } from '../../detected-crimes/entities/detected-crime.entity';
import type { MinioService } from '../../minio/minio.service';
import type { User } from '../../users/user.entity';
import type { Application } from '../application.entity';
import type { Transfer } from '../transfers/transfer.entity';
import type { ApplicationDocument } from './application-document.entity';
import { DocumentActor, DocumentsService } from './documents.service';
import type { DocumentTemplate } from './templates/document-template.entity';
import type { DocxEngineService } from './templates/docx-engine.service';
import { signOnlyOfficeJwt } from './utils/onlyoffice-security.util';

const SECRET = 'uvd_onlyoffice_dev_secret_key_2026';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let documentsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let applicationsRepo: { findOne: jest.Mock };
  let detectedCrimeRepo: { findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let templateRepo: { find: jest.Mock; findOne: jest.Mock };
  let transferRepo: { find: jest.Mock };
  let minioService: {
    uploadBuffer: jest.Mock;
    getFileStream: jest.Mock;
    deleteFile: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let docxEngine: { renderTemplate: jest.Mock };

  beforeEach(() => {
    documentsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v: Record<string, unknown>) => ({ id: 'doc-1', ...v })),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
      remove: jest.fn((v: unknown) => Promise.resolve(v)),
    };
    applicationsRepo = { findOne: jest.fn() };
    detectedCrimeRepo = { findOne: jest.fn() };
    usersRepo = { findOne: jest.fn() };
    templateRepo = { find: jest.fn(), findOne: jest.fn() };
    transferRepo = { find: jest.fn().mockResolvedValue([]) };
    minioService = {
      uploadBuffer: jest.fn((_buf: Buffer, key: string) =>
        Promise.resolve({
          key,
          url: `http://minio/${key}`,
        }),
      ),
      getFileStream: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'ONLYOFFICE_JWT_SECRET') return SECRET;
        if (key === 'ONLYOFFICE_INTERNAL_URL') return 'http://uvd_app_onlyoffice';
        return undefined;
      }),
    };
    docxEngine = {
      renderTemplate: jest.fn(() => Buffer.from('rendered-docx')),
    };

    service = new DocumentsService(
      documentsRepo as unknown as Repository<ApplicationDocument>,
      applicationsRepo as unknown as Repository<Application>,
      detectedCrimeRepo as unknown as Repository<DetectedCrime>,
      usersRepo as unknown as Repository<User>,
      templateRepo as unknown as Repository<DocumentTemplate>,
      transferRepo as unknown as Repository<Transfer>,
      minioService as unknown as MinioService,
      configService as unknown as ConfigService,
      docxEngine as unknown as DocxEngineService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('RBAC & district isolation', () => {
    const officer: DocumentActor = {
      sub: 'auth-officer-1',
      role: Role.DISTRICT_OFFICER,
      username: 'officer1',
    };

    it('blocks DISTRICT_OFFICER from reading documents of another district application', async () => {
      applicationsRepo.findOne.mockResolvedValue({ id: 'app-2', district_id: 'dist-B' });
      usersRepo.findOne.mockResolvedValue({
        id: 'user-db-1',
        auth_id: 'auth-officer-1',
        district_id: 'dist-A',
        assigned_districts: [],
      });

      await expect(service.getDocumentsByApplication('app-2', officer)).rejects.toThrow(
        ForbiddenException,
      );
      expect(documentsRepo.find).not.toHaveBeenCalled();
    });

    it('blocks DISTRICT_OFFICER from generating a dynamic template document on another district application', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'tpl-1',
        title: 'Bayonnoma',
        file_key: 'templates/tpl-1.docx',
      });
      applicationsRepo.findOne.mockResolvedValue({
        id: 'app-other',
        district_id: 'dist-B',
        application_number: 'AR-2026-009',
      });
      usersRepo.findOne.mockResolvedValue({
        id: 'user-db-1',
        auth_id: 'auth-officer-1',
        district_id: 'dist-A',
        assigned_districts: [],
      });

      await expect(
        service.createFromTemplate('app-other', { templateId: 'tpl-1', script: 'lotin' }, officer),
      ).rejects.toThrow(ForbiddenException);
      expect(minioService.getFileStream).not.toHaveBeenCalled();
      expect(documentsRepo.save).not.toHaveBeenCalled();
    });

    it('enforces is_deleted: false when loading application for template preview and dynamic generation', async () => {
      applicationsRepo.findOne.mockResolvedValue(null);

      await expect(service.getTemplatePreview('deleted-app', 'blank', 'lotin')).rejects.toThrow(
        NotFoundException,
      );
      expect(applicationsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'deleted-app', is_deleted: false },
        }),
      );
    });

    it('sets ONLYOFFICE editor to read-only view mode without callbackUrl for BOSS role', async () => {
      documentsRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        application_id: 'app-1',
        title: 'Hisobot',
        file_name: 'hisobot.docx',
        file_type: 'docx',
        doc_key: 'doc_key_1',
        updated_at: new Date('2026-04-01T10:00:00Z'),
      });
      usersRepo.findOne.mockResolvedValue({
        id: 'boss-db-1',
        first_name: 'Akmal',
        last_name: 'Karimov',
      });

      const cfg = await service.getDocumentEditorConfig('doc-1', {
        sub: 'auth-boss',
        role: Role.BOSS,
        username: 'boss',
      });

      expect(cfg.editorConfig.mode).toBe('view');
      expect('callbackUrl' in cfg.editorConfig).toBe(false);
      expect(cfg.document.permissions.edit).toBe(false);
      expect(cfg.document.permissions.download).toBe(true);
      expect(cfg.token).toBeTruthy();
    });
  });

  describe('createFromTemplate (dynamic templates)', () => {
    it('loads Cyrillic file_key_krill when script=krill and stores resolved DB user id (not auth_id) in created_by_id', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'tpl-1',
        title: 'Sanksiya',
        title_krill: 'Санкция',
        file_key: 'templates/lotin.docx',
        file_key_krill: 'templates/krill.docx',
      });
      applicationsRepo.findOne.mockResolvedValue({
        id: 'app-1',
        application_number: 'AR-2026-015',
        district_id: 'dist-1',
        citizen: { full_name: 'Aliyev Vali' },
      });
      usersRepo.findOne.mockResolvedValue({
        id: 'db-user-uuid-99',
        auth_id: 'auth-sub-11',
        first_name: 'Jasur',
        last_name: 'Raximov',
      });
      minioService.getFileStream.mockResolvedValue(Readable.from([Buffer.from('tpl-bytes')]));

      const saved = await service.createFromTemplate(
        'app-1',
        { templateId: 'tpl-1', script: 'krill' },
        { sub: 'auth-sub-11', role: Role.STAFF },
      );

      expect(minioService.getFileStream).toHaveBeenCalledWith('templates/krill.docx');
      expect(docxEngine.renderTemplate).toHaveBeenCalled();
      expect(saved.created_by_id).toBe('db-user-uuid-99');
      expect(saved.title).toBe('Санкция');
    });

    it('rejects unknown non-dynamic templateId with BadRequestException', async () => {
      templateRepo.findOne.mockRejectedValue(new Error('invalid input syntax for type uuid'));

      await expect(
        service.createFromTemplate('app-1', { templateId: 'non-existent-tpl', script: 'lotin' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleCallback (ONLYOFFICE save lifecycle)', () => {
    it('rejects callback with mismatched doc_key to prevent stale session overwrites', async () => {
      const token = signOnlyOfficeJwt(
        { status: 2, key: 'stale_key', url: 'http://uvd_app_onlyoffice/cache/file.docx' },
        SECRET,
      );
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
      documentsRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        doc_key: 'current_key',
        file_key: 'documents/app-1/f.docx',
        file_name: 'f.docx',
        version: 1,
      });

      const res = await service.handleCallback('doc-1', {}, req);

      expect(res).toEqual({ error: 1 });
      expect(minioService.uploadBuffer).not.toHaveBeenCalled();
      expect(documentsRepo.save).not.toHaveBeenCalled();
    });

    it('downloads updated file safely, increments version, and rotates doc_key on status 2', async () => {
      const token = signOnlyOfficeJwt(
        { status: 2, key: 'current_key', url: 'http://evil-host/cache/files/updated.docx' },
        SECRET,
      );
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
      const docRecord = {
        id: 'doc-1',
        doc_key: 'current_key',
        file_key: 'documents/app-1/f.docx',
        file_name: 'f.docx',
        version: 2,
        size: 100,
      };
      documentsRepo.findOne.mockResolvedValue(docRecord);

      const newBytes = Buffer.from('updated-docx-bytes');
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(newBytes.length) }),
        body: null,
        arrayBuffer: () =>
          Promise.resolve(
            newBytes.buffer.slice(newBytes.byteOffset, newBytes.byteOffset + newBytes.byteLength),
          ),
      } as unknown as Response);

      const res = await service.handleCallback('doc-1', {}, req);

      expect(res).toEqual({ error: 0 });
      // SSRF rewrite enforced
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://uvd_app_onlyoffice/cache/files/updated.docx',
        expect.anything(),
      );
      expect(minioService.uploadBuffer).toHaveBeenCalledWith(
        newBytes,
        'documents/app-1/f.docx',
        expect.any(String),
        'f.docx',
      );
      expect(docRecord.version).toBe(3);
      expect(docRecord.size).toBe(newBytes.length);
      expect(docRecord.doc_key).not.toBe('current_key');
      expect(documentsRepo.save).toHaveBeenCalledWith(docRecord);
    });
  });

  describe('deleteDocument', () => {
    it('removes DB record even if MinIO deletion warns/fails', async () => {
      const docRecord = { id: 'doc-1', file_key: 'documents/app-1/f.docx' };
      documentsRepo.findOne.mockResolvedValue(docRecord);
      minioService.deleteFile.mockRejectedValue(new Error('NoSuchKey'));

      const result = await service.deleteDocument('doc-1', { sub: 'admin', role: Role.ADMIN });

      expect(result).toBe(true);
      expect(documentsRepo.remove).toHaveBeenCalledWith(docRecord);
    });
  });
});
