import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { District } from './district.entity';
import type { CreateDistrictDto } from './dto/create-district.dto';
import type { UpdateDistrictDto } from './dto/update-district.dto';

@Injectable()
export class DistrictsService {
  constructor(
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
  ) {}

  async create(dto: CreateDistrictDto): Promise<District> {
    const district = this.districtRepo.create(dto);
    return this.districtRepo.save(district);
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<District>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<District> | FindOptionsWhere<District>[] = {};
    if (search) {
      const q = `%${search}%`;
      where = [{ name: ILike(q) }];
    }

    const [items, total] = await this.districtRepo.findAndCount({
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

  async findOne(id: string): Promise<District> {
    const district = await this.districtRepo.findOne({
      where: { id },
      relations: { applications: true },
    });

    if (!district) {
      throw new NotFoundException(`Tuman / Bo'lim (ID: ${id}) topilmadi`);
    }

    return district;
  }

  async update(id: string, dto: UpdateDistrictDto): Promise<District> {
    const district = await this.findOne(id);
    Object.assign(district, dto);
    return this.districtRepo.save(district);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const district = await this.findOne(id);
    await this.districtRepo.remove(district);
    return {
      success: true,
      message: "Tuman / Bo'lim muvaffaqiyatli o'chirildi",
    };
  }
}
