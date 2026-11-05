import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import type { CreateMahallaDto } from './dto/create-mahalla.dto';
import type { UpdateMahallaDto } from './dto/update-mahalla.dto';
import { Mahalla } from './mahalla.entity';

@Injectable()
export class MahallasService {
  constructor(
    @InjectRepository(Mahalla)
    private readonly mahallaRepo: Repository<Mahalla>,
  ) {}

  async create(dto: CreateMahallaDto): Promise<Mahalla> {
    const mahalla = this.mahallaRepo.create({
      name: dto.name.trim(),
      district_id: dto.district_id,
    });
    return this.mahallaRepo.save(mahalla);
  }

  async findAll(
    page = 1,
    limit = 100,
    districtId?: string,
    search?: string,
  ): Promise<PaginatedResult<Mahalla>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Mahalla> | FindOptionsWhere<Mahalla>[] = {};

    if (districtId && search) {
      const q = `%${search.trim()}%`;
      where = {
        district_id: districtId,
        name: ILike(q),
      };
    } else if (districtId) {
      where = {
        district_id: districtId,
      };
    } else if (search) {
      const q = `%${search.trim()}%`;
      where = {
        name: ILike(q),
      };
    }

    const [items, total] = await this.mahallaRepo.findAndCount({
      where,
      relations: {
        district: true,
      },
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

  async findOne(id: string): Promise<Mahalla> {
    const mahalla = await this.mahallaRepo.findOne({
      where: { id },
      relations: { district: true },
    });

    if (!mahalla) {
      throw new NotFoundException(`Mahalla (ID: ${id}) topilmadi`);
    }

    return mahalla;
  }

  async update(id: string, dto: UpdateMahallaDto): Promise<Mahalla> {
    const mahalla = await this.findOne(id);
    if (dto.name !== undefined) {
      mahalla.name = dto.name.trim();
    }
    if (dto.district_id !== undefined) {
      mahalla.district_id = dto.district_id;
    }
    return this.mahallaRepo.save(mahalla);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const mahalla = await this.findOne(id);
    await this.mahallaRepo.remove(mahalla);
    return { success: true, message: "Mahalla muvaffaqiyatli o'chirildi" };
  }
}
