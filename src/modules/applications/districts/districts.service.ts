import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { DEFAULT_QASHQADARYO_DISTRICTS } from '../seeds/qashqadaryo-data';
import { District } from './district.entity';
import type { CreateDistrictDto } from './dto/create-district.dto';
import type { UpdateDistrictDto } from './dto/update-district.dto';

@Injectable()
export class DistrictsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DistrictsService.name);

  constructor(
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedDefaultDistricts();
  }

  async seedDefaultDistricts(): Promise<void> {
    try {
      let createdCount = 0;
      for (const name of DEFAULT_QASHQADARYO_DISTRICTS) {
        const existing = await this.districtRepo.findOne({
          where: { name: ILike(name.trim()) },
        });
        if (!existing) {
          const district = this.districtRepo.create({ name: name.trim() });
          await this.districtRepo.save(district);
          createdCount++;
        }
      }
      if (createdCount > 0) {
        this.logger.log(`Boshlang'ich ${createdCount} ta tuman bazaga kiritildi`);
      }
    } catch (error) {
      this.logger.error('Boshlang‘ich tumanlarni kiritishda xatolik:', error);
    }
  }

  async create(dto: CreateDistrictDto): Promise<District> {
    const district = this.districtRepo.create(dto);
    return this.districtRepo.save(district);
  }

  async findAll(page = 1, limit = 100, search?: string): Promise<PaginatedResult<District>> {
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
    await assertNoDependencies(
      this.districtRepo.manager,
      `«${district.name}» tumani`,
      district.id,
      [
        {
          table: 'applications',
          column: 'district_id',
          label: 'ariza',
          extraWhere: 'is_deleted = false',
        },
        { table: 'citizens', column: 'district_id', label: 'fuqaro' },
        { table: 'mahallas', column: 'district_id', label: 'mahalla' },
        { table: 'user_assigned_districts', column: 'district_id', label: 'biriktirilgan xodim' },
      ],
    );
    await this.districtRepo.remove(district);
    return {
      success: true,
      message: "Tuman / Bo'lim muvaffaqiyatli o'chirildi",
    };
  }
}
