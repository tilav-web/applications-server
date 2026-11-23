import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { District } from '../districts/district.entity';
import { DEFAULT_QASHQADARYO_MAHALLAS } from '../seeds/qashqadaryo-data';
import type { CreateMahallaDto } from './dto/create-mahalla.dto';
import type { UpdateMahallaDto } from './dto/update-mahalla.dto';
import { Mahalla } from './mahalla.entity';

@Injectable()
export class MahallasService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MahallasService.name);

  constructor(
    @InjectRepository(Mahalla)
    private readonly mahallaRepo: Repository<Mahalla>,
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedDefaultMahallas();
  }

  async seedDefaultMahallas(): Promise<void> {
    try {
      const totalMahallas = await this.mahallaRepo.count();
      if (totalMahallas >= 700) {
        return;
      }

      // Tumanlar ro'yxatini yuklab olish
      const districts = await this.districtRepo.find();
      const districtMap = new Map<string, string>();
      for (const d of districts) {
        if (d.name) {
          districtMap.set(d.name.toLowerCase().trim(), d.id);
        }
      }

      if (districtMap.size === 0) {
        this.logger.warn('Tumanlar topilmadi, mahallalarni kiritish keyinga qoldirildi');
        return;
      }

      // Mavjud mahallalarni tekshirish (dublikat bo'lmasligi uchun)
      const existingMahallas = await this.mahallaRepo.find({
        select: { name: true, district_id: true },
      });
      const existingKeySet = new Set(
        existingMahallas.map((m) => `${m.district_id}_${m.name.toLowerCase().trim()}`),
      );

      const toInsert: Partial<Mahalla>[] = [];
      for (const item of DEFAULT_QASHQADARYO_MAHALLAS) {
        const dId = districtMap.get(item.district.toLowerCase().trim());
        if (!dId) continue;

        const key = `${dId}_${item.name.toLowerCase().trim()}`;
        if (!existingKeySet.has(key)) {
          toInsert.push({
            name: item.name.trim(),
            district_id: dId,
            tracking_id: item.tracking_id || null,
          });
          existingKeySet.add(key);
        }
      }

      if (toInsert.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < toInsert.length; i += batchSize) {
          const chunk = toInsert.slice(i, i + batchSize);
          await this.mahallaRepo.save(this.mahallaRepo.create(chunk));
        }
        this.logger.log(`Boshlang'ich ${toInsert.length} ta mahalla bazaga kiritildi`);
      }
    } catch (error) {
      this.logger.error('Boshlang‘ich mahallalarni kiritishda xatolik:', error);
    }
  }

  async create(dto: CreateMahallaDto): Promise<Mahalla> {
    const mahalla = this.mahallaRepo.create({
      name: dto.name.trim(),
      district_id: dto.district_id,
    });
    return this.mahallaRepo.save(mahalla);
  }

  async findAll(
    page = 1,
    limit = 200,
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
      delete (mahalla as unknown as Record<string, unknown>).district;
    }
    await this.mahallaRepo.save(mahalla);
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const mahalla = await this.findOne(id);
    await assertNoDependencies(
      this.mahallaRepo.manager,
      `«${mahalla.name}» mahallasi`,
      mahalla.id,
      [{ table: 'citizens', column: 'mahalla_id', label: 'fuqaro' }],
    );
    await this.mahallaRepo.remove(mahalla);
    return { success: true, message: "Mahalla muvaffaqiyatli o'chirildi" };
  }
}
