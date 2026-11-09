import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { Crime } from './crime.entity';
import type { CreateCrimeDto } from './dto/create-crime.dto';
import type { UpdateCrimeDto } from './dto/update-crime.dto';

@Injectable()
export class CrimesService {
  constructor(
    @InjectRepository(Crime)
    private readonly crimeRepo: Repository<Crime>,
  ) {}

  async create(dto: CreateCrimeDto): Promise<Crime> {
    const crime = this.crimeRepo.create(dto);
    return this.crimeRepo.save(crime);
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<Crime>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Crime> | FindOptionsWhere<Crime>[] = {};
    if (search) {
      const q = `%${search}%`;
      where = [
        { article: ILike(q) },
        { title: ILike(q) },
        { category: ILike(q) },
      ];
    }

    const [items, total] = await this.crimeRepo.findAndCount({
      where,
      order: { article: 'ASC' },
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

  async findOne(id: string): Promise<Crime> {
    const crime = await this.crimeRepo.findOne({
      where: { id },
      relations: { applications: true },
    });

    if (!crime) {
      throw new NotFoundException(`Jinoyat moddasi (ID: ${id}) topilmadi`);
    }

    return crime;
  }

  async update(id: string, dto: UpdateCrimeDto): Promise<Crime> {
    const crime = await this.findOne(id);
    Object.assign(crime, dto);
    return this.crimeRepo.save(crime);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const crime = await this.findOne(id);
    await this.crimeRepo.remove(crime);
    return {
      success: true,
      message: "Jinoyat moddasi muvaffaqiyatli o'chirildi",
    };
  }
}
