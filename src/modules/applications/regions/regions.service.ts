import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { isPgUniqueViolation } from '../../../common/utils/normalization.util';
import { DEFAULT_QASHQADARYO_REGION } from '../seeds/qashqadaryo-geo-coords';
import type { CreateRegionDto } from './dto/create-region.dto';
import type { UpdateRegionDto } from './dto/update-region.dto';
import { Region } from './region.entity';

@Injectable()
export class RegionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegionsService.name);

  constructor(
    @InjectRepository(Region)
    private readonly regionRepo: Repository<Region>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDefaultRegion();
  }

  /**
   * Default Qashqadaryo viloyatini bazada mavjudligini ta'minlash (yagona ob'ekt)
   */
  async ensureDefaultRegion(): Promise<Region | null> {
    try {
      let existing = await this.regionRepo.findOne({
        where: [
          { code: ILike(DEFAULT_QASHQADARYO_REGION.code) },
          { name: ILike(DEFAULT_QASHQADARYO_REGION.name) },
          { name: ILike('Qashqadaryo') },
        ],
      });

      if (!existing) {
        try {
          existing = await this.regionRepo.save(
            this.regionRepo.create({
              name: DEFAULT_QASHQADARYO_REGION.name,
              code: DEFAULT_QASHQADARYO_REGION.code,
              latitude: DEFAULT_QASHQADARYO_REGION.latitude,
              longitude: DEFAULT_QASHQADARYO_REGION.longitude,
            }),
          );
          this.logger.log(`Default viloyat yaratildi: ${existing.name}`);
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            existing = await this.regionRepo.findOne({
              where: { name: ILike(DEFAULT_QASHQADARYO_REGION.name) },
            });
          } else {
            throw err;
          }
        }
      } else if (existing.latitude == null || existing.longitude == null || !existing.code) {
        if (existing.latitude == null) existing.latitude = DEFAULT_QASHQADARYO_REGION.latitude;
        if (existing.longitude == null) existing.longitude = DEFAULT_QASHQADARYO_REGION.longitude;
        if (!existing.code) existing.code = DEFAULT_QASHQADARYO_REGION.code;
        existing = await this.regionRepo.save(existing);
      }

      return existing;
    } catch (error) {
      this.logger.error('Default Qashqadaryo viloyatini yaratishda xatolik:', error);
      return null;
    }
  }

  async create(dto: CreateRegionDto): Promise<Region> {
    const cleanName = dto.name?.trim();
    if (!cleanName) {
      throw new BadRequestException('Viloyat nomi kiritilishi shart');
    }

    const existing = await this.regionRepo.findOne({ where: { name: ILike(cleanName) } });
    if (existing) return existing;

    const region = this.regionRepo.create({
      name: cleanName,
      code: dto.code ? dto.code.trim().toUpperCase() : null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    });

    try {
      return await this.regionRepo.save(region);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        const raceExisting = await this.regionRepo.findOne({ where: { name: ILike(cleanName) } });
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
  }

  async findAll(page = 1, limit = 100, search?: string): Promise<PaginatedResult<Region>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Region> | FindOptionsWhere<Region>[] = {};
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      where = [{ name: ILike(q) }, { code: ILike(q) }];
    }

    const [items, total] = await this.regionRepo.findAndCount({
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

  async findOne(id: string): Promise<Region> {
    const region = await this.regionRepo.findOne({ where: { id } });
    if (!region) {
      throw new NotFoundException(`Viloyat (ID: ${id}) topilmadi`);
    }
    return region;
  }

  async update(id: string, dto: UpdateRegionDto): Promise<Region> {
    const region = await this.findOne(id);
    if (dto.name !== undefined) {
      const cleanName = dto.name.trim();
      if (!cleanName) throw new BadRequestException("Viloyat nomi bo'sh bo'lishi mumkin emas");
      const existing = await this.regionRepo.findOne({ where: { name: ILike(cleanName) } });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`"${cleanName}" nomli viloyat allaqachon mavjud`);
      }
      region.name = cleanName;
    }
    if (dto.code !== undefined) {
      region.code = dto.code ? dto.code.trim().toUpperCase() : null;
    }
    if (dto.latitude !== undefined) {
      region.latitude = dto.latitude;
    }
    if (dto.longitude !== undefined) {
      region.longitude = dto.longitude;
    }
    return this.regionRepo.save(region);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const region = await this.findOne(id);
    await assertNoDependencies(this.regionRepo.manager, `«${region.name}» viloyati`, region.id, [
      { table: 'districts', column: 'region_id', label: 'tuman / shahar' },
    ]);
    await this.regionRepo.remove(region);
    return {
      success: true,
      message: "Viloyat muvaffaqiyatli o'chirildi",
    };
  }
}
