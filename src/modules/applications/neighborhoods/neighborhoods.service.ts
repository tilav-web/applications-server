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
import { District } from '../districts/district.entity';
import { DEFAULT_QASHQADARYO_NEIGHBORHOODS } from '../seeds/qashqadaryo-data';
import { DEFAULT_QASHQADARYO_NEIGHBORHOOD_COORDS } from '../seeds/qashqadaryo-geo-coords';
import type { CreateNeighborhoodDto } from './dto/create-neighborhood.dto';
import type { UpdateNeighborhoodDto } from './dto/update-neighborhood.dto';
import { Neighborhood } from './neighborhood.entity';

function buildNeighborhoodCoordLookup(): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  for (const [key, coords] of Object.entries(DEFAULT_QASHQADARYO_NEIGHBORHOOD_COORDS)) {
    map.set(key.toLowerCase().trim(), coords);
  }
  return map;
}

@Injectable()
export class NeighborhoodsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NeighborhoodsService.name);

  constructor(
    @InjectRepository(Neighborhood)
    private readonly neighborhoodRepo: Repository<Neighborhood>,
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedDefaultNeighborhoods();
  }

  async seedDefaultNeighborhoods(): Promise<void> {
    try {
      const districts = await this.districtRepo.find();
      const districtMap = new Map<string, string>();
      const districtNameById = new Map<string, string>();
      for (const d of districts) {
        if (d.name) {
          districtMap.set(d.name.toLowerCase().trim(), d.id);
          districtNameById.set(d.id, d.name.trim());
        }
      }

      if (districtMap.size === 0) {
        this.logger.warn('Tumanlar topilmadi, mahallalarni kiritish keyinga qoldirildi');
        return;
      }

      const coordLookup = buildNeighborhoodCoordLookup();

      const totalNeighborhoods = await this.neighborhoodRepo.count();
      if (totalNeighborhoods === 0) {
        const existingNeighborhoods = await this.neighborhoodRepo.find({
          select: { name: true, district_id: true },
        });
        const existingKeySet = new Set(
          existingNeighborhoods.map((n) => `${n.district_id}_${n.name.toLowerCase().trim()}`),
        );

        const toInsert: Partial<Neighborhood>[] = [];
        for (const item of DEFAULT_QASHQADARYO_NEIGHBORHOODS) {
          const dId = districtMap.get(item.district.toLowerCase().trim());
          if (!dId) continue;

          const key = `${dId}_${item.name.toLowerCase().trim()}`;
          if (!existingKeySet.has(key)) {
            const coordKey = `${item.district.trim()}__${item.name.trim()}`.toLowerCase();
            const coords = coordLookup.get(coordKey);
            toInsert.push({
              name: item.name.trim(),
              district_id: dId,
              tracking_id: item.tracking_id || null,
              latitude: coords ? coords[0] : null,
              longitude: coords ? coords[1] : null,
            });
            existingKeySet.add(key);
          }
        }

        if (toInsert.length > 0) {
          const batchSize = 100;
          for (let i = 0; i < toInsert.length; i += batchSize) {
            const chunk = toInsert.slice(i, i + batchSize);
            await this.neighborhoodRepo.save(this.neighborhoodRepo.create(chunk));
          }
          this.logger.log(`Boshlang'ich ${toInsert.length} ta mahalla bazaga kiritildi`);
        }
      }

      // Mavjud mahallalarning bo'sh koordinatalarini to'ldirish (backfill)
      const missingCoords = await this.neighborhoodRepo
        .createQueryBuilder('n')
        .where('n.latitude IS NULL OR n.longitude IS NULL')
        .getMany();

      if (missingCoords.length > 0) {
        const toUpdate: Neighborhood[] = [];
        for (const n of missingCoords) {
          const dName = districtNameById.get(n.district_id);
          if (!dName) continue;
          const coordKey = `${dName}__${n.name.trim()}`.toLowerCase();
          const coords = coordLookup.get(coordKey);
          if (coords) {
            if (n.latitude == null) n.latitude = coords[0];
            if (n.longitude == null) n.longitude = coords[1];
            toUpdate.push(n);
          }
        }
        if (toUpdate.length > 0) {
          const batchSize = 100;
          for (let i = 0; i < toUpdate.length; i += batchSize) {
            await this.neighborhoodRepo.save(toUpdate.slice(i, i + batchSize));
          }
          this.logger.log(`Mavjud ${toUpdate.length} ta mahalla koordinatalari bazaga yozildi`);
        }
      }
    } catch (error) {
      this.logger.error('Boshlang‘ich mahallalarni kiritishda xatolik:', error);
    }
  }

  async create(dto: CreateNeighborhoodDto): Promise<Neighborhood> {
    const cleanName = dto.name.trim();
    if (!cleanName) throw new BadRequestException('Mahalla nomi kiritilishi shart');
    const existing = await this.neighborhoodRepo.findOne({
      where: { district_id: dto.district_id, name: ILike(cleanName) },
      relations: { district: { region: true } },
    });
    if (existing) return existing;

    const neighborhood = this.neighborhoodRepo.create({
      name: cleanName,
      district_id: dto.district_id,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    });
    try {
      const saved = await this.neighborhoodRepo.save(neighborhood);
      return this.findOne(saved.id);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        const raceExisting = await this.neighborhoodRepo.findOne({
          where: { district_id: dto.district_id, name: ILike(cleanName) },
          relations: { district: { region: true } },
        });
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
  }

  async findAll(
    page = 1,
    limit = 200,
    districtId?: string,
    search?: string,
  ): Promise<PaginatedResult<Neighborhood>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Neighborhood> | FindOptionsWhere<Neighborhood>[] = {};

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

    const [items, total] = await this.neighborhoodRepo.findAndCount({
      where,
      relations: {
        district: { region: true },
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

  async findOne(id: string): Promise<Neighborhood> {
    const neighborhood = await this.neighborhoodRepo.findOne({
      where: { id },
      relations: { district: { region: true } },
    });

    if (!neighborhood) {
      throw new NotFoundException(`Mahalla (ID: ${id}) topilmadi`);
    }

    return neighborhood;
  }

  async update(id: string, dto: UpdateNeighborhoodDto): Promise<Neighborhood> {
    const neighborhood = await this.findOne(id);
    const nextName = dto.name !== undefined ? dto.name.trim() : neighborhood.name;
    const nextDistrictId =
      dto.district_id !== undefined ? dto.district_id : neighborhood.district_id;
    if (!nextName) throw new BadRequestException("Mahalla nomi bo'sh bo'lishi mumkin emas");

    const existing = await this.neighborhoodRepo.findOne({
      where: { district_id: nextDistrictId, name: ILike(nextName) },
    });
    if (existing && existing.id !== id) {
      throw new BadRequestException(`Bu tumanda "${nextName}" mahallasi allaqachon mavjud`);
    }

    if (dto.name !== undefined) {
      neighborhood.name = nextName;
    }
    if (dto.district_id !== undefined) {
      neighborhood.district_id = nextDistrictId;
      delete (neighborhood as unknown as Record<string, unknown>).district;
    }
    if (dto.latitude !== undefined) {
      neighborhood.latitude = dto.latitude;
    }
    if (dto.longitude !== undefined) {
      neighborhood.longitude = dto.longitude;
    }
    await this.neighborhoodRepo.save(neighborhood);
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const neighborhood = await this.findOne(id);
    await assertNoDependencies(
      this.neighborhoodRepo.manager,
      `«${neighborhood.name}» mahallasi`,
      neighborhood.id,
      [
        { table: 'citizens', column: 'neighborhood_id', label: 'fuqaro' },
        { table: 'workplaces', column: 'neighborhood_id', label: 'ish joyi / tashkilot' },
      ],
    );
    await this.neighborhoodRepo.remove(neighborhood);
    return { success: true, message: "Mahalla muvaffaqiyatli o'chirildi" };
  }
}
