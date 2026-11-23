import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { formatTitleCase } from '../../../../common/utils/name-formatter.util';
import { Bank } from './bank.entity';
import type { CreateBankDto } from './dto/create-bank.dto';
import type { UpdateBankDto } from './dto/update-bank.dto';

@Injectable()
export class BanksService {
  constructor(
    @InjectRepository(Bank)
    private readonly bankRepo: Repository<Bank>,
  ) {}

  async create(dto: CreateBankDto): Promise<Bank> {
    const bank = this.bankRepo.create({
      ...dto,
      name: dto.name ? formatTitleCase(dto.name) : '',
    });
    return this.bankRepo.save(bank);
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<Bank>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Bank> | FindOptionsWhere<Bank>[] = {};
    if (search) {
      const q = `%${search}%`;
      where = [{ name: ILike(q) }, { code: ILike(q) }, { mfo: ILike(q) }];
    }

    const [items, total] = await this.bankRepo.findAndCount({
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

  async findOne(id: string): Promise<Bank> {
    const bank = await this.bankRepo.findOne({
      where: { id },
      relations: { cards: true },
    });

    if (!bank) {
      throw new NotFoundException(`Bank (ID: ${id}) topilmadi`);
    }

    return bank;
  }

  async update(id: string, dto: UpdateBankDto): Promise<Bank> {
    const bank = await this.findOne(id);
    const updatedData: Partial<Bank> = { ...dto };
    if (dto.name !== undefined) {
      updatedData.name = dto.name ? formatTitleCase(dto.name) : '';
    }
    Object.assign(bank, updatedData);
    return this.bankRepo.save(bank);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const bank = await this.findOne(id);
    await assertNoDependencies(this.bankRepo.manager, `«${bank.name}» banki`, bank.id, [
      { table: 'cards', column: 'bank_id', label: 'plastik karta' },
    ]);
    await this.bankRepo.remove(bank);
    return { success: true, message: "Bank muvaffaqiyatli o'chirildi" };
  }
}
