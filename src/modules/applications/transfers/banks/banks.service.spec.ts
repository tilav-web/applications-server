import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { Bank } from './bank.entity';
import { BanksService, DEFAULT_UZBEKISTAN_BANKS } from './banks.service';

describe('BanksService', () => {
  let service: BanksService;
  let bankRepo: {
    count: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    manager: { query: jest.Mock };
  };

  beforeEach(() => {
    bankRepo = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      create: jest.fn((d: Partial<Bank>) => ({ ...d })),
      save: jest.fn((e: Partial<Bank>) => Promise.resolve({ id: 'bank-1', ...e })),
      remove: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([{ cnt: 0 }]) },
    };

    service = new BanksService(bankRepo as unknown as Repository<Bank>);
  });

  describe('seedDefaults', () => {
    it('skips seeding when banks table is already populated', async () => {
      bankRepo.count.mockResolvedValue(5);
      await service.seedDefaults();
      expect(bankRepo.findOne).not.toHaveBeenCalled();
      expect(bankRepo.save).not.toHaveBeenCalled();
    });

    it('seeds all default Uzbekistan banks when table is empty', async () => {
      bankRepo.count.mockResolvedValue(0);
      bankRepo.findOne.mockResolvedValue(null);

      await service.seedDefaults();

      expect(bankRepo.save).toHaveBeenCalledTimes(DEFAULT_UZBEKISTAN_BANKS.length);
    });
  });

  describe('create (deduplication & validation)', () => {
    it('rejects empty or whitespace-only bank name with BadRequestException', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow(BadRequestException);
      expect(bankRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns existing bank without creating duplicate when matched by name or mfo', async () => {
      const existing = { id: 'b-agro', name: 'Agrobank', mfo: '00394' } as Bank;
      bankRepo.findOne.mockResolvedValue(existing);

      const res = await service.create({ name: '  AGROBANK ', mfo: ' 00394 ' });

      expect(res).toBe(existing);
      expect(bankRepo.save).not.toHaveBeenCalled();
    });

    it('formats Title Case name, trims mfo, and recovers from concurrent 23505 race', async () => {
      const winner = { id: 'b-race', name: 'Yangi Bank', mfo: '09999' } as Bank;
      bankRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      bankRepo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });

      const res = await service.create({ name: 'yangi bank', mfo: ' 09999 ' });
      expect(res).toBe(winner);
    });
  });

  describe('findAll', () => {
    it('trims and escapes LIKE wildcards in search and clamps pagination', async () => {
      bankRepo.findAndCount.mockResolvedValue([[{ id: 'b-1', name: 'Uzum Bank' }], 1]);

      const res = await service.findAll(0, -5, '  UZUM_BANK% ');

      expect(bankRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 1,
        }),
      );
      const findCalls = bankRepo.findAndCount.mock.calls as Array<
        [{ where: Array<Record<string, { value: string }>> }]
      >;
      const whereArg = findCalls[0][0].where;
      expect(whereArg[0].name.value).toBe('%UZUM\\_BANK\\%%');
      expect(res.meta).toEqual({
        total: 1,
        page: 1,
        limit: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe('update', () => {
    it('loads bank without cards relation, rejects duplicate name/mfo of another bank, and normalizes blank mfo to null', async () => {
      bankRepo.findOne.mockResolvedValueOnce({ id: 'b-1', name: 'Agrobank', mfo: '00394' });

      const updated = await service.update('b-1', { mfo: '   ' });

      expect(bankRepo.findOne).toHaveBeenCalledWith({ where: { id: 'b-1' } });
      expect(updated.mfo).toBeNull();
    });

    it('throws BadRequestException when renaming to an existing bank name of another id', async () => {
      bankRepo.findOne
        .mockResolvedValueOnce({ id: 'b-1', name: 'Agrobank' })
        .mockResolvedValueOnce({ id: 'b-2', name: 'Kapitalbank' });

      await expect(service.update('b-1', { name: 'kapitalbank' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when setting duplicate mfo of another bank', async () => {
      bankRepo.findOne
        .mockResolvedValueOnce({ id: 'b-1', name: 'Agrobank', mfo: '00394' })
        .mockResolvedValueOnce({ id: 'b-2', name: 'Kapitalbank', mfo: '00974' });

      await expect(service.update('b-1', { mfo: '00974' })).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on concurrent 23505 during save', async () => {
      bankRepo.findOne
        .mockResolvedValueOnce({ id: 'b-1', name: 'Agrobank' })
        .mockResolvedValueOnce(null);
      bankRepo.save.mockRejectedValueOnce({ code: '23505' });

      await expect(service.update('b-1', { name: 'New Bank' })).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when bank does not exist', async () => {
      bankRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('blocks deletion with ConflictException when cards reference the bank', async () => {
      bankRepo.findOne.mockResolvedValue({ id: 'b-1', name: 'Agrobank' });
      bankRepo.manager.query
        .mockResolvedValueOnce([{ cnt: 4 }])
        .mockResolvedValueOnce([{ cnt: 0 }]);

      await expect(service.remove('b-1')).rejects.toThrow(ConflictException);
      expect(bankRepo.remove).not.toHaveBeenCalled();
    });

    it('deletes bank cleanly without loading cards relation when unreferenced', async () => {
      const bank = { id: 'b-1', name: 'Unused Bank' };
      bankRepo.findOne.mockResolvedValue(bank);
      bankRepo.manager.query.mockResolvedValue([{ cnt: 0 }]);

      const res = await service.remove('b-1');

      expect(bankRepo.findOne).toHaveBeenCalledWith({ where: { id: 'b-1' } });
      expect(bankRepo.remove).toHaveBeenCalledWith(bank);
      expect(res.success).toBe(true);
    });
  });
});
