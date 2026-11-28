import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { DetectedCrimeStatusesService } from './detected-crime-statuses.service';
import type { DetectedCrimeStatus } from './entities/detected-crime-status.entity';

describe('DetectedCrimeStatusesService', () => {
  let service: DetectedCrimeStatusesService;
  let repo: {
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    manager: { query: jest.Mock };
  };

  beforeEach(() => {
    repo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((d: Partial<DetectedCrimeStatus>) => ({ ...d })),
      save: jest.fn((e: Partial<DetectedCrimeStatus>) => Promise.resolve({ id: 'cst-1', ...e })),
      update: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([{ cnt: 0 }]) },
    };

    service = new DetectedCrimeStatusesService(repo as unknown as Repository<DetectedCrimeStatus>);
  });

  describe('onModuleInit', () => {
    it('skips seeding when statuses already exist and seeds defaults when empty', async () => {
      repo.count.mockResolvedValueOnce(2);
      await service.onModuleInit();
      expect(repo.save).not.toHaveBeenCalled();

      repo.count.mockResolvedValueOnce(0);
      repo.findOne.mockResolvedValue(null);
      await service.onModuleInit();
      expect(repo.save).toHaveBeenCalledTimes(6);
    });

    it('swallows early-migration DB errors gracefully during bootstrap', async () => {
      repo.count.mockRejectedValueOnce(new Error('relation does not exist'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('rejects empty name with BadRequestException', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('handles Cyrillic-only name without querying empty code and auto-generates ST_ code', async () => {
      repo.findOne.mockResolvedValue(null);

      const saved = await service.create({ name: 'Текширувда', is_default: true });

      const findCalls = repo.findOne.mock.calls as Array<
        [{ where: Array<Record<string, unknown>> }]
      >;
      // Only name filter in where array — NO empty `{ code: '' }` lookup!
      expect(findCalls[0][0].where).toHaveLength(1);
      expect(repo.update).toHaveBeenCalledWith({ is_default: true }, { is_default: false });
      expect(saved.code).toMatch(/^ST_\d+$/);
    });

    it('rejects duplicate name/code or concurrent 23505 with ConflictException', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'existing' });
      await expect(service.create({ name: 'Fosh etildi' })).rejects.toThrow(ConflictException);

      repo.findOne.mockResolvedValueOnce(null);
      repo.save.mockRejectedValueOnce({ code: '23505' });
      await expect(service.create({ name: 'Yangi status' })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException if missing and BadRequestException on blank name', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);

      repo.findOne.mockResolvedValueOnce({ id: 'cst-1', name: 'Old' });
      await expect(service.update('cst-1', { name: '  ' })).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate name OR duplicate code belonging to another status with ConflictException', async () => {
      repo.findOne
        .mockResolvedValueOnce({ id: 'cst-1', name: 'Old', code: 'OLD' })
        .mockResolvedValueOnce({ id: 'cst-2', name: 'Taken' });
      await expect(service.update('cst-1', { name: 'Taken' })).rejects.toThrow(ConflictException);

      repo.findOne
        .mockResolvedValueOnce({ id: 'cst-1', name: 'Old', code: 'OLD' })
        .mockResolvedValueOnce({ id: 'cst-2', code: 'YAKUNLANDI' });
      await expect(service.update('cst-1', { code: 'yakunlandi' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('clears previous default when setting is_default = true and maps 23505 to ConflictException', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'cst-1', name: 'A', code: 'A', is_default: false });
      const res = await service.update('cst-1', { is_default: true, is_final: true });
      expect(repo.update).toHaveBeenCalledWith({ is_default: true }, { is_default: false });
      expect(res.is_default).toBe(true);

      repo.findOne.mockResolvedValueOnce({ id: 'cst-1', name: 'A', code: 'A' });
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      await expect(service.update('cst-1', { color: 'red' })).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('blocks deletion with ConflictException when active detected crimes use this status', async () => {
      repo.findOne.mockResolvedValue({ id: 'cst-1', name: 'Fosh etildi' });
      repo.manager.query.mockResolvedValueOnce([{ cnt: 3 }]);

      await expect(service.remove('cst-1')).rejects.toThrow(ConflictException);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('deletes cleanly when unreferenced', async () => {
      const entity = { id: 'cst-1', name: 'Unused' };
      repo.findOne.mockResolvedValue(entity);
      repo.manager.query.mockResolvedValueOnce([{ cnt: 0 }]);

      const res = await service.remove('cst-1');
      expect(repo.remove).toHaveBeenCalledWith(entity);
      expect(res.success).toBe(true);
    });
  });
});
