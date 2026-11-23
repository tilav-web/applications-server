import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { Workplace } from './workplace.entity';

export interface CreateWorkplaceInput {
  name: string;
  district_id?: string | null;
  mahalla_id?: string | null;
  occupation_category_id?: string | null;
  address?: string | null;
  inn?: string | null;
  is_active?: boolean;
}

@Injectable()
export class WorkplacesService {
  constructor(
    @InjectRepository(Workplace)
    private readonly repo: Repository<Workplace>,
  ) {}

  async findAll(params?: {
    page?: number;
    limit?: number;
    search?: string;
    district_id?: string;
    occupation_category_id?: string;
    include_inactive?: boolean;
  }): Promise<PaginatedResult<Workplace>> {
    const page = Math.max(1, Number(params?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(params?.limit) || 20));
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.district', 'district')
      .leftJoinAndSelect('w.mahalla', 'mahalla')
      .leftJoinAndSelect('w.occupation_category', 'occupation_category')
      .orderBy('w.name', 'ASC');

    if (!params?.include_inactive) {
      qb.andWhere('w.is_active = :active', { active: true });
    }

    if (params?.district_id && params.district_id.trim()) {
      qb.andWhere('w.district_id = :districtId', { districtId: params.district_id.trim() });
    }

    if (params?.occupation_category_id && params.occupation_category_id.trim()) {
      qb.andWhere('w.occupation_category_id = :catId', {
        catId: params.occupation_category_id.trim(),
      });
    }

    if (params?.search && params.search.trim()) {
      const q = `%${params.search.trim()}%`;
      qb.andWhere(
        '(w.name ILIKE :q OR w.address ILIKE :q OR w.inn ILIKE :q OR district.name ILIKE :q)',
        { q },
      );
    }

    const [items, total] = await qb.skip(skip).take(limit).getManyAndCount();
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

  async findOne(id: string): Promise<Workplace> {
    const wp = await this.repo.findOne({
      where: { id },
      relations: { district: true, mahalla: true, occupation_category: true },
    });
    if (!wp) throw new NotFoundException(`Ish joyi / tashkilot (ID: ${id}) topilmadi`);
    return wp;
  }

  /**
   * Deduplikatsiya tamoyili (AGENTS.md):
   * Avval STIR (inn) yoki (district_id + LOWER(name)) bo'yicha qidiradi.
   * Mavjud bo'lsa uni qaytaradi, yo'q bo'lsa 1 marta yaratadi.
   */
  async findOrCreate(data: CreateWorkplaceInput): Promise<Workplace> {
    const cleanName = (data.name || '').trim();
    if (!cleanName) {
      throw new BadRequestException('Ish joyi / tashkilot nomi kiritilishi shart');
    }

    const cleanInn = data.inn ? data.inn.replace(/\D/g, '').trim() || null : null;
    const districtId = data.district_id?.trim() || null;

    let existing: Workplace | null = null;
    if (cleanInn) {
      existing = await this.repo.findOne({ where: { inn: cleanInn } });
    }
    if (!existing) {
      const qb = this.repo
        .createQueryBuilder('w')
        .where('LOWER(TRIM(w.name)) = LOWER(:name)', { name: cleanName });
      if (districtId) {
        qb.andWhere('w.district_id = :districtId', { districtId });
      } else {
        qb.andWhere('w.district_id IS NULL');
      }
      existing = await qb.getOne();
    }

    if (existing) {
      // Bo'sh maydonlarni yumshoq boyitamiz
      let dirty = false;
      if (!existing.mahalla_id && data.mahalla_id) {
        existing.mahalla_id = data.mahalla_id;
        dirty = true;
      }
      if (!existing.occupation_category_id && data.occupation_category_id) {
        existing.occupation_category_id = data.occupation_category_id;
        dirty = true;
      }
      if (!existing.address && data.address?.trim()) {
        existing.address = data.address.trim();
        dirty = true;
      }
      if (!existing.inn && cleanInn) {
        existing.inn = cleanInn;
        dirty = true;
      }
      if (dirty) await this.repo.save(existing);
      return this.findOne(existing.id);
    }

    const created = this.repo.create({
      name: cleanName,
      district_id: districtId,
      mahalla_id: data.mahalla_id?.trim() || null,
      occupation_category_id: data.occupation_category_id?.trim() || null,
      address: data.address?.trim() || null,
      inn: cleanInn,
      is_active: data.is_active ?? true,
    });
    const saved = await this.repo.save(created);
    return this.findOne(saved.id);
  }

  async create(data: CreateWorkplaceInput): Promise<Workplace> {
    return this.findOrCreate(data);
  }

  async update(id: string, data: Partial<CreateWorkplaceInput>): Promise<Workplace> {
    const wp = await this.findOne(id);
    delete (wp as unknown as Record<string, unknown>).district;
    delete (wp as unknown as Record<string, unknown>).mahalla;
    delete (wp as unknown as Record<string, unknown>).occupation_category;

    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      if (!cleanName) throw new BadRequestException('Nom bo‘sh bo‘lishi mumkin emas');
      wp.name = cleanName;
    }
    if (data.district_id !== undefined) wp.district_id = data.district_id || null;
    if (data.mahalla_id !== undefined) wp.mahalla_id = data.mahalla_id || null;
    if (data.occupation_category_id !== undefined) {
      wp.occupation_category_id = data.occupation_category_id || null;
    }
    if (data.address !== undefined) wp.address = data.address?.trim() || null;
    if (data.inn !== undefined) {
      wp.inn = data.inn ? data.inn.replace(/\D/g, '').trim() || null : null;
    }
    if (data.is_active !== undefined) wp.is_active = Boolean(data.is_active);

    await this.repo.save(wp);
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const wp = await this.findOne(id);
    await assertNoDependencies(this.repo.manager, `«${wp.name}» ish joyi / tashkiloti`, wp.id, [
      {
        table: 'applications',
        column: 'workplace_id',
        label: 'ariza',
        extraWhere: 'is_deleted = false',
      },
      { table: 'citizens', column: 'workplace_id', label: 'fuqaro' },
    ]);
    await this.repo.remove(wp);
    return { success: true, message: "Ish joyi / tashkilot muvaffaqiyatli o'chirildi" };
  }
}
