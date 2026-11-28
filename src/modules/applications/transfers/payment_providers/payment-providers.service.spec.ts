import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { PaymentProvider } from './payment_provider.entity';
import { DEFAULT_PAYMENT_PROVIDERS, PaymentProvidersService } from './payment-providers.service';

describe('PaymentProvidersService', () => {
  let service: PaymentProvidersService;
  let providerRepo: {
    count: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    manager: { query: jest.Mock };
  };

  beforeEach(() => {
    providerRepo = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      create: jest.fn((d: Partial<PaymentProvider>) => ({ ...d })),
      save: jest.fn((e: Partial<PaymentProvider>) => Promise.resolve({ id: 'prov-1', ...e })),
      remove: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([{ cnt: 0 }]) },
    };

    service = new PaymentProvidersService(providerRepo as unknown as Repository<PaymentProvider>);
  });

  describe('seedDefaults', () => {
    it('skips seeding when table already has providers', async () => {
      providerRepo.count.mockResolvedValue(3);
      await service.seedDefaults();
      expect(providerRepo.save).not.toHaveBeenCalled();
    });

    it('seeds all default providers when table is empty', async () => {
      providerRepo.count.mockResolvedValue(0);
      providerRepo.findOne.mockResolvedValue(null);

      await service.seedDefaults();
      expect(providerRepo.save).toHaveBeenCalledTimes(DEFAULT_PAYMENT_PROVIDERS.length);
    });
  });

  describe('create (deduplication & generated code matching)', () => {
    it('rejects empty name with BadRequestException', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('collapses extra spaces and checks generated code BEFORE insert so double-spaced names deduplicate', async () => {
      const existing = { id: 'p-1', name: 'Uzum Bank', code: 'uzum_bank' } as PaymentProvider;
      providerRepo.findOne.mockResolvedValue(existing);

      const res = await service.create({ name: '  Uzum   Bank  ' });

      expect(res).toBe(existing);
      const findOneCalls = providerRepo.findOne.mock.calls as Array<
        [{ where: Array<Record<string, unknown>> }]
      >;
      const whereArg = findOneCalls[0][0].where;
      expect(whereArg).toEqual(expect.arrayContaining([{ code: 'uzum_bank' }]));
      expect(providerRepo.save).not.toHaveBeenCalled();
    });

    it('recovers from concurrent PG 23505 on create', async () => {
      const winner = { id: 'p-race', name: 'Click', code: 'click' } as PaymentProvider;
      providerRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      providerRepo.save.mockRejectedValueOnce({ code: '23505' });

      const res = await service.create({ name: 'Click' });
      expect(res).toBe(winner);
    });
  });

  describe('findAll', () => {
    it('escapes underscores in provider code search and clamps invalid pagination', async () => {
      providerRepo.findAndCount.mockResolvedValue([[{ id: 'p-1', code: 'alif_mobi' }], 1]);

      const res = await service.findAll(-1, 0, '  alif_mobi ');

      const findCalls = providerRepo.findAndCount.mock.calls as Array<
        [{ where: Array<Record<string, { value: string }>> }]
      >;
      const whereArg = findCalls[0][0].where;
      expect(whereArg[1].code.value).toBe('%alif\\_mobi%');
      expect(res.meta.page).toBe(1);
      expect(res.meta.limit).toBe(1);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when provider does not exist', async () => {
      providerRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'Payme' })).rejects.toThrow(NotFoundException);
    });

    it('rejects duplicate name or duplicate code of another provider', async () => {
      providerRepo.findOne
        .mockResolvedValueOnce({ id: 'p-1', name: 'Click', code: 'click' })
        .mockResolvedValueOnce({ id: 'p-2', name: 'Payme', code: 'payme' });

      await expect(service.update('p-1', { name: 'Payme' })).rejects.toThrow(BadRequestException);

      providerRepo.findOne
        .mockResolvedValueOnce({ id: 'p-1', name: 'Click', code: 'click' })
        .mockResolvedValueOnce({ id: 'p-2', name: 'Payme', code: 'payme' });

      await expect(service.update('p-1', { code: 'PAYME' })).rejects.toThrow(BadRequestException);
    });

    it('converts concurrent 23505 during update save into ConflictException', async () => {
      providerRepo.findOne
        .mockResolvedValueOnce({ id: 'p-1', name: 'Click', code: 'click' })
        .mockResolvedValueOnce(null);
      providerRepo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });

      await expect(service.update('p-1', { name: 'Paynet' })).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('blocks deletion with ConflictException when linked to transfers', async () => {
      providerRepo.findOne.mockResolvedValue({ id: 'p-1', name: 'Click' });
      providerRepo.manager.query
        .mockResolvedValueOnce([{ cnt: 2 }])
        .mockResolvedValueOnce([{ cnt: 0 }]);

      await expect(service.remove('p-1')).rejects.toThrow(ConflictException);
      expect(providerRepo.remove).not.toHaveBeenCalled();
    });

    it('deletes cleanly when unreferenced', async () => {
      const entity = { id: 'p-1', name: 'OldPay' };
      providerRepo.findOne.mockResolvedValue(entity);
      providerRepo.manager.query.mockResolvedValue([{ cnt: 0 }]);

      const res = await service.remove('p-1');
      expect(providerRepo.remove).toHaveBeenCalledWith(entity);
      expect(res.success).toBe(true);
    });
  });
});
