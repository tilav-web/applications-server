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
import { RegionsService } from '../regions/regions.service';
import { DEFAULT_QASHQADARYO_DISTRICTS } from '../seeds/qashqadaryo-data';
import { DEFAULT_QASHQADARYO_DISTRICT_COORDS } from '../seeds/qashqadaryo-geo-coords';
import { District } from './district.entity';
import type { CreateDistrictDto } from './dto/create-district.dto';
import type { UpdateDistrictDto } from './dto/update-district.dto';

@Injectable()
export class DistrictsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DistrictsService.name);

  constructor(
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    private readonly regionsService: RegionsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedDefaultDistricts();
  }

  async seedDefaultDistricts(): Promise<void> {
    try {
      // Avval default "Qashqadaryo viloyati" mavjudligini ta'minlaymiz
      const defaultRegion = await this.regionsService.ensureDefaultRegion();
      const defaultRegionId = defaultRegion?.id ?? null;

      const existingDistrictCount = await this.districtRepo.count();
      const isInitialSeed = existingDistrictCount === 0;

      let createdCount = 0;
      let updatedCount = 0;

      for (const rawName of DEFAULT_QASHQADARYO_DISTRICTS) {
        const name = rawName.trim();
        const coords = DEFAULT_QASHQADARYO_DISTRICT_COORDS[name];
        const existing = await this.districtRepo.findOne({
          where: { name: ILike(name) },
        });

        if (!existing) {
          if (!isInitialSeed) continue;
          const district = this.districtRepo.create({
            name,
            region_id: defaultRegionId,
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
          });
          await this.districtRepo.save(district);
          createdCount++;
        } else {
          let dirty = false;
          if (!existing.region_id && defaultRegionId) {
            existing.region_id = defaultRegionId;
            dirty = true;
          }
          if (existing.latitude == null && coords?.latitude != null) {
            existing.latitude = coords.latitude;
            dirty = true;
          }
          if (existing.longitude == null && coords?.longitude != null) {
            existing.longitude = coords.longitude;
            dirty = true;
          }
          if (dirty) {
            await this.districtRepo.save(existing);
            updatedCount++;
          }
        }
      }

      if (createdCount > 0 || updatedCount > 0) {
        this.logger.log(
          `Qashqadaryo tumanlari sinxronlandi: ${createdCount} ta yaratildi, ${updatedCount} ta viloyat/koordinata bilan yangilandi`,
        );
      }
    } catch (error) {
      this.logger.error('Boshlang‘ich tumanlarni kiritishda xatolik:', error);
    }
  }

  async create(dto: CreateDistrictDto): Promise<District> {
    const cleanName = dto.name?.trim();
    if (!cleanName) {
      throw new BadRequestException('Tuman nomi kiritilishi shart');
    }
    const existing = await this.districtRepo.findOne({
      where: { name: ILike(cleanName) },
      relations: { region: true },
    });
    if (existing) return existing;

    if (dto.region_id) {
      await this.regionsService.findOne(dto.region_id);
    }

    const district = this.districtRepo.create({
      name: cleanName,
      region_id: dto.region_id ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    });

    try {
      const saved = await this.districtRepo.save(district);
      return this.findOne(saved.id);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        const raceExisting = await this.districtRepo.findOne({
          where: { name: ILike(cleanName) },
          relations: { region: true },
        });
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
  }

  async findAll(
    page = 1,
    limit = 100,
    search?: string,
    regionId?: string,
  ): Promise<PaginatedResult<District>> {
    const take = limit;
    const skip = (page - 1) * limit;

    const where: FindOptionsWhere<District> = {};
    if (search && search.trim()) {
      where.name = ILike(`%${search.trim()}%`);
    }
    if (regionId) {
      where.region_id = regionId;
    }

    const [items, total] = await this.districtRepo.findAndCount({
      where,
      relations: { region: true },
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
      relations: { region: true },
    });

    if (!district) {
      throw new NotFoundException(`Tuman / Bo'lim (ID: ${id}) topilmadi`);
    }

    return district;
  }

  async update(id: string, dto: UpdateDistrictDto): Promise<District> {
    const district = await this.findOne(id);
    if (dto.name !== undefined) {
      const cleanName = dto.name.trim();
      if (!cleanName) throw new BadRequestException("Tuman nomi bo'sh bo'lishi mumkin emas");
      const existing = await this.districtRepo.findOne({ where: { name: ILike(cleanName) } });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`"${cleanName}" nomli tuman allaqachon mavjud`);
      }
      district.name = cleanName;
    }
    if (dto.region_id !== undefined) {
      if (dto.region_id) {
        await this.regionsService.findOne(dto.region_id);
      }
      district.region_id = dto.region_id || null;
      delete (district as unknown as Record<string, unknown>).region;
    }
    if (dto.latitude !== undefined) {
      district.latitude = dto.latitude;
    }
    if (dto.longitude !== undefined) {
      district.longitude = dto.longitude;
    }
    await this.districtRepo.save(district);
    return this.findOne(id);
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
        { table: 'neighborhoods', column: 'district_id', label: 'mahalla' },
        { table: 'workplaces', column: 'district_id', label: 'ish joyi / tashkilot' },
        {
          table: 'detected_crimes',
          column: 'district_id',
          label: 'aniqlangan jinoyat',
          extraWhere: 'is_deleted = false',
        },
        { table: 'user_assigned_districts', column: 'district_id', label: 'biriktirilgan xodim' },
        {
          table: 'application_custom_fields',
          column: 'district_id',
          label: "ariza qo'shimcha maydoni",
        },
      ],
    );
    await this.districtRepo.remove(district);
    return {
      success: true,
      message: "Tuman / Bo'lim muvaffaqiyatli o'chirildi",
    };
  }
}
