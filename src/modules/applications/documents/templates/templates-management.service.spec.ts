import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import type { Repository } from 'typeorm';

import { Role } from '../../../../common/enums/role.enum';
import type { MinioService } from '../../../minio/minio.service';
import type { User } from '../../../users/user.entity';
import type { Application } from '../../application.entity';
import type { SuspectFieldConfig } from '../../suspect-fields/suspect-field-config.entity';
import type { Transfer } from '../../transfers/transfer.entity';
import type { DocumentTemplate } from './document-template.entity';
import type { DocxEngineService } from './docx-engine.service';
import { TemplatesManagementService } from './templates-management.service';

function createMockQb(items: unknown[] = []) {
  const qb = {
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(items),
  };
  qb.andWhere.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  return qb;
}

describe('TemplatesManagementService', () => {
  let service: TemplatesManagementService;
  let templateRepo: {
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let applicationRepo: { findOne: jest.Mock };
  let transferRepo: { find: jest.Mock };
  let suspectFieldConfigRepo: { find: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let minioService: { uploadBuffer: jest.Mock; deleteFile: jest.Mock; getFileStream: jest.Mock };
  let configService: { get: jest.Mock };
  let docxEngine: {
    validateTemplate: jest.Mock;
    renderTemplate: jest.Mock;
    extractTags: jest.Mock;
  };

  beforeEach(() => {
    templateRepo = {
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn((d: Partial<DocumentTemplate>) => ({ ...d })),
      save: jest.fn((e: Partial<DocumentTemplate>) => Promise.resolve({ id: 'tpl-1', ...e })),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => createMockQb()),
    };
    applicationRepo = { findOne: jest.fn() };
    transferRepo = { find: jest.fn().mockResolvedValue([]) };
    suspectFieldConfigRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { findOne: jest.fn().mockResolvedValue(null) };
    minioService = {
      uploadBuffer: jest.fn((_b: Buffer, key: string) => Promise.resolve({ key })),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getFileStream: jest.fn(() => Promise.resolve(Readable.from([Buffer.from('docx-bytes')]))),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'ONLYOFFICE_JWT_SECRET') return 'test-secret-key-for-onlyoffice-jwt-123456';
        return undefined;
      }),
    };
    docxEngine = {
      validateTemplate: jest
        .fn()
        .mockReturnValue({ valid: true, errors: [], tags: ['citizen.full_name'] }),
      renderTemplate: jest.fn().mockReturnValue(Buffer.from('rendered-docx')),
      extractTags: jest.fn().mockReturnValue(['citizen.full_name']),
    };

    service = new TemplatesManagementService(
      templateRepo as unknown as Repository<DocumentTemplate>,
      applicationRepo as unknown as Repository<Application>,
      transferRepo as unknown as Repository<Transfer>,
      suspectFieldConfigRepo as unknown as Repository<SuspectFieldConfig>,
      userRepo as unknown as Repository<User>,
      minioService as unknown as MinioService,
      configService as unknown as ConfigService,
      docxEngine as unknown as DocxEngineService,
    );
  });

  describe('getAllTemplates & getTemplateById', () => {
    it('escapes LIKE wildcards and resolves displayTitle according to requested script', async () => {
      const qb = createMockQb([
        { id: 't1', title: 'Sanksiya', title_krill: 'Санкция' },
        { id: 't2', title: 'Bayonnoma', title_krill: null },
      ]);
      templateRepo.createQueryBuilder.mockReturnValue(qb);

      const list = await service.getAllTemplates('krill', 'Sanksiya', '100%_test');

      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('LIKE :search'), {
        search: '%100\\%\\_test%',
      });
      expect(list[0].displayTitle).toBe('Санкция');
      expect(list[1].displayTitle).toBe('Bayonnoma');
    });

    it('throws NotFoundException when template does not exist', async () => {
      templateRepo.findOne.mockResolvedValue(null);
      await expect(service.getTemplateById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createBlankTemplate, uploadTemplateFile, updateTemplate & deleteTemplate', () => {
    it('rejects blank title on createBlankTemplate and updateTemplate, and handles nullable title_krill/category cleanly', async () => {
      await expect(service.createBlankTemplate({ title: '   ' })).rejects.toThrow(
        BadRequestException,
      );

      templateRepo.findOne.mockResolvedValue({ id: 't1', title: 'Old', title_krill: 'Эски' });
      await expect(service.updateTemplate('t1', { title: '   ' })).rejects.toThrow(
        BadRequestException,
      );

      const updated = await service.updateTemplate('t1', {
        title: 'New Title',
        title_krill: '',
        category: '',
      });
      expect(updated.title).toBe('New Title');
      expect(updated.title_krill).toBeNull();
      expect(updated.category).toBeNull();
    });

    it('rejects missing or non-.docx files in uploadTemplateFile and stores extracted tags on valid upload', async () => {
      await expect(
        service.uploadTemplateFile(undefined as unknown as Express.Multer.File, { title: 'X' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadTemplateFile(
          { originalname: 'bad.pdf', buffer: Buffer.from('x'), size: 1 } as Express.Multer.File,
          { title: 'X' },
        ),
      ).rejects.toThrow(BadRequestException);

      const saved = await service.uploadTemplateFile(
        {
          originalname: 'sanksiya namuna.docx',
          buffer: Buffer.from('docx'),
          size: 4,
        } as Express.Multer.File,
        { title: 'Sanksiya' },
        { sub: 'auth-1' },
      );

      expect(saved.available_tags).toEqual(['citizen.full_name']);
      expect(minioService.uploadBuffer).toHaveBeenCalledTimes(1);
    });

    it('deletes both Lotin and Krill MinIO files on deleteTemplate', async () => {
      const tpl = { id: 't1', file_key: 'templates/a.docx', file_key_krill: 'templates/a_kr.docx' };
      templateRepo.findOne.mockResolvedValue(tpl);

      const ok = await service.deleteTemplate('t1');
      expect(ok).toBe(true);
      expect(minioService.deleteFile).toHaveBeenCalledWith('templates/a.docx');
      expect(minioService.deleteFile).toHaveBeenCalledWith('templates/a_kr.docx');
      expect(templateRepo.remove).toHaveBeenCalledWith(tpl);
    });
  });

  describe('ONLYOFFICE editor config & callback & testGenerateTemplate', () => {
    it('gives edit mode + callbackUrl to ADMIN and view-only mode without callbackUrl to BOSS', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 't1',
        title: 'Shablon',
        doc_key: 'tpl_key_1',
        updated_at: new Date(),
      });

      const adminCfg = await service.getTemplateEditorConfig('t1', {
        sub: 'u1',
        role: Role.ADMIN,
        username: 'admin',
      });
      expect(adminCfg.editorConfig.mode).toBe('edit');
      expect(adminCfg.editorConfig.callbackUrl).toContain('/templates/t1/callback');

      const bossCfg = await service.getTemplateEditorConfig('t1', {
        sub: 'u2',
        role: Role.BOSS,
        username: 'boss',
      });
      expect(bossCfg.editorConfig.mode).toBe('view');
      expect(bossCfg.editorConfig).not.toHaveProperty('callbackUrl');
    });

    it('rejects callback with mismatched doc_key (error: 1) and acknowledges non-save status (error: 0)', async () => {
      const ack = await service.handleTemplateCallback('t1', { status: 1 });
      expect(ack).toEqual({ error: 0 });

      templateRepo.findOne.mockResolvedValue({ id: 't1', doc_key: 'expected_key' });
      const mismatch = await service.handleTemplateCallback('t1', {
        status: 2,
        url: 'http://uvd_app_onlyoffice/file.docx',
        key: 'wrong_key',
      });
      expect(mismatch).toEqual({ error: 1 });
    });

    it('uses file_key_krill for krill script and enforces DISTRICT_OFFICER scope when testing against an application', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 't1',
        file_key: 'templates/lotin.docx',
        file_key_krill: 'templates/krill.docx',
      });

      await service.testGenerateTemplate('t1', undefined, 'krill');
      expect(minioService.getFileStream).toHaveBeenCalledWith('templates/krill.docx');

      applicationRepo.findOne.mockResolvedValue({ id: 'app-other', district_id: 'dist-2' });
      userRepo.findOne.mockResolvedValue({ assigned_districts: [{ id: 'dist-1' }] });
      await expect(
        service.testGenerateTemplate('t1', 'app-other', 'lotin', {
          sub: 'auth-off',
          role: Role.DISTRICT_OFFICER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
