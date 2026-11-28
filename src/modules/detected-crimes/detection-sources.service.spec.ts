import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { DetectionSourcesService } from './detection-sources.service';
import type { DetectionSource } from './entities/detection-source.entity';

function createMockQb(getOneResult: unknown = null, getManyResult: unknown[] = []) {
  const qb = {
    where: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getOne: jest.fn().mockResolvedValue(getOneResult),
    getMany: jest.fn().mockResolvedValue(getManyResult),
  };
  qb.where.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  return qb;
}

describe('DetectionSourcesService', () => {
  let service: DetectionSourcesService;
  let repo: {
    count: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { query: jest.Mock };
  };

  beforeEach(() => {
    repo = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
      create: jest.fn((d: Partial<DetectionSource>) => ({ ...d })),
      save: jest.fn((e: Partial<DetectionSource>) => Promise.resolve({ id: 'src-1', ...e })),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => createMockQb()),
      manager: { query: jest.fn().mockResolvedValue([{ cnt: 0 }]) },
    };

    service = new DetectionSourcesService(repo as unknown as Repository<DetectionSource>);
  });

  describe('seedDefaults & findAll', () => {
    it('skips seeding when already populated and seeds 5 defaults when empty', async () => {
      repo.count.mockResolvedValueOnce(1);
      await service.seedDefaults();
      expect(repo.save).not.toHaveBeenCalled();

      repo.count.mockResolvedValueOnce(0);
      await service.seedDefaults();
      expect(repo.save).toHaveBeenCalledTimes(5);
    });

    it('filters active sources by default and includes inactive when requested', async () => {
      const qb1 = createMockQb(null, [{ id: 's1' }]);
      repo.createQueryBuilder.mockReturnValueOnce(qb1);
      await service.findAll(false);
      expect(qb1.where).toHaveBeenCalledWith('ds.is_active = :active', { active: true });

      const qb2 = createMockQb(null, [{ id: 's1' }, { id: 's2' }]);
      repo.createQueryBuilder.mockReturnValueOnce(qb2);
      await service.findAll(true);
      expect(qb2.where).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('rejects blank name, duplicate name, duplicate code, and concurrent 23505', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow(BadRequestException);

      repo.createQueryBuilder.mockReturnValueOnce(createMockQb({ id: 'dup' }));
      await expect(service.create({ name: 'Kiber-monitoring' })).rejects.toThrow(
        BadRequestException,
      );

      repo.createQueryBuilder.mockReturnValueOnce(createMockQb(null));
      repo.findOne.mockResolvedValueOnce({ id: 'dup-code', code: 'CYBER_MONITORING' });
      await expect(
        service.create({ name: 'Yangi usul', code: 'cyber_monitoring' }),
      ).rejects.toThrow(ConflictException);

      repo.createQueryBuilder.mockReturnValueOnce(createMockQb(null));
      repo.findOne.mockResolvedValueOnce(null);
      repo.save.mockRejectedValueOnce({ code: '23505' });
      await expect(service.create({ name: 'Yangi usul 2', code: 'NEW_CODE' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException if missing, rejects duplicate name/code, and normalizes blank code to null', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.update('missing', { name: 'A' })).rejects.toThrow(NotFoundException);

      repo.findOne.mockResolvedValueOnce({ id: 'src-1', name: 'Old', code: 'OLD' });
      repo.findOne.mockResolvedValueOnce({ id: 'src-2', code: 'TAKEN' });
      await expect(service.update('src-1', { code: 'taken' })).rejects.toThrow(ConflictException);

      repo.findOne.mockResolvedValueOnce({ id: 'src-1', name: 'Old', code: 'OLD' });
      const updated = await service.update('src-1', { code: '   ' });
      expect(updated.code).toBeNull();
    });
  });

  describe('remove', () => {
    it('blocks deletion with ConflictException when active detected crimes reference this source', async () => {
      repo.findOne.mockResolvedValue({ id: 'src-1', name: 'TQT' });
      repo.manager.query.mockResolvedValueOnce([{ cnt: 2 }]);

      await expect(service.remove('src-1')).rejects.toThrow(ConflictException);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('deletes cleanly when unreferenced', async () => {
      const entity = { id: 'src-1', name: 'Unused' };
      repo.findOne.mockResolvedValue(entity);
      repo.manager.query.mockResolvedValueOnce([{ cnt: 0 }]);

      const res = await service.remove('src-1');
      expect(repo.remove).toHaveBeenCalledWith(entity);
      expect(res.success).toBe(true);
    });
  });
});
