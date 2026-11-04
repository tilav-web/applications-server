import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import type { CreatePaymentProviderDto } from './dto/create-payment-provider.dto';
import type { UpdatePaymentProviderDto } from './dto/update-payment-provider.dto';
import { PaymentProvider } from './payment_provider.entity';

@Injectable()
export class PaymentProvidersService {
  constructor(
    @InjectRepository(PaymentProvider)
    private readonly providerRepo: Repository<PaymentProvider>,
  ) {}

  async create(dto: CreatePaymentProviderDto): Promise<PaymentProvider> {
    const provider = this.providerRepo.create(dto);
    return this.providerRepo.save(provider);
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<PaymentProvider>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<PaymentProvider> | FindOptionsWhere<PaymentProvider>[] = {};
    if (search) {
      const q = `%${search}%`;
      where = [{ name: ILike(q) }, { code: ILike(q) }];
    }

    const [items, total] = await this.providerRepo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip,
      take,
    });

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

  async findOne(id: string): Promise<PaymentProvider> {
    const provider = await this.providerRepo.findOne({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`To'lov provayderi (ID: ${id}) topilmadi`);
    }

    return provider;
  }

  async update(id: string, dto: UpdatePaymentProviderDto): Promise<PaymentProvider> {
    const provider = await this.findOne(id);
    Object.assign(provider, dto);
    return this.providerRepo.save(provider);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const provider = await this.findOne(id);
    await this.providerRepo.remove(provider);
    return {
      success: true,
      message: "To'lov provayderi muvaffaqiyatli o'chirildi",
    };
  }
}
