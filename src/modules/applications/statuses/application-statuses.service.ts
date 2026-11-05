import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { Application } from '../application.entity';
import { ApplicationStatus } from './application-status.entity';
import type { CreateApplicationStatusDto } from './dto/create-application-status.dto';
import type { UpdateApplicationStatusDto } from './dto/update-application-status.dto';

const DEFAULT_STATUSES = [
  {
    name: 'Yangi (Qabul qilindi)',
    code: 'YANGI',
    color: 'blue',
    description: 'Yangi kelib tushgan ariza yoki murojaat',
    is_default: true,
    sort_order: 1,
  },
  {
    name: 'Jarayonda (Tergovda)',
    code: 'JARAYONDA',
    color: 'amber',
    description: 'Tergovga qadar tekshiruv yoki tergov jarayonida',
    is_default: false,
    sort_order: 2,
  },
  {
    name: 'Hal qilindi',
    code: 'HAL_QILINDI',
    color: 'emerald',
    description: 'Ariza ijobiy hal etilgan yoki jinoyat fosh etilgan',
    is_default: false,
    sort_order: 3,
  },
  {
    name: 'Rad etildi',
    code: 'RAD_ETILDI',
    color: 'rose',
    description: 'Qanoatlantirish rad etilgan yoki asossiz deb topilgan',
    is_default: false,
    sort_order: 4,
  },
];

@Injectable()
export class ApplicationStatusesService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(ApplicationStatus)
    private readonly statusRepo: Repository<ApplicationStatus>,
    @InjectRepository(Application)
    private readonly appRepo: Repository<Application>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedDefaultStatuses();
  }

  async seedDefaultStatuses(): Promise<void> {
    try {
      for (const ds of DEFAULT_STATUSES) {
        let existing = await this.statusRepo.findOne({
          where: [{ name: ILike(ds.name) }, { code: ds.code }],
        });
        if (!existing) {
          existing = this.statusRepo.create(ds);
          await this.statusRepo.save(existing);
        }
      }

      // Mavjud arizalarda status_id bo'sh bo'lsa, ularga mos status_id ni bog'laymiz
      const allStatuses = await this.statusRepo.find();
      const defaultStatus = allStatuses.find((s) => s.code === 'YANGI') || allStatuses[0];
      const statusMap = new Map<string, string>();
      for (const st of allStatuses) {
        if (st.code) statusMap.set(st.code.toUpperCase(), st.id);
        statusMap.set(st.name.toUpperCase(), st.id);
      }

      const unlinkedApps = await this.appRepo.find({
        where: { status_id: IsNull() },
        select: { id: true, status: true },
      });

      for (const app of unlinkedApps) {
        const matchingId =
          (app.status && statusMap.get(app.status.toUpperCase())) || defaultStatus?.id;
        if (matchingId) {
          await this.appRepo.update(app.id, { status_id: matchingId });
        }
      }
    } catch (err) {
      console.error('[ApplicationStatusesService] Error seeding default statuses:', err);
    }
  }

  async create(dto: CreateApplicationStatusDto): Promise<ApplicationStatus> {
    const trimmedName = dto.name.trim();
    const existing = await this.statusRepo.findOne({
      where: [
        { name: ILike(trimmedName) },
        ...(dto.code ? [{ code: dto.code.trim().toUpperCase() }] : []),
      ],
    });
    if (existing) {
      throw new BadRequestException(`"${trimmedName}" nomli yoki kodli status allaqachon mavjud`);
    }

    if (dto.is_default) {
      await this.statusRepo.update({}, { is_default: false });
    }

    const code = dto.code
      ? dto.code.trim().toUpperCase()
      : trimmedName
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, '_')
          .slice(0, 50);

    const status = this.statusRepo.create({
      ...dto,
      name: trimmedName,
      code,
      color: dto.color || 'blue',
      is_default: Boolean(dto.is_default),
      sort_order: dto.sort_order ?? 0,
    });

    return this.statusRepo.save(status);
  }

  async findAll(
    page = 1,
    limit = 50,
    search?: string,
  ): Promise<PaginatedResult<ApplicationStatus>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<ApplicationStatus> | FindOptionsWhere<ApplicationStatus>[] = {};
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      where = [{ name: ILike(q) }, { code: ILike(q) }];
    }

    const [items, total] = await this.statusRepo.findAndCount({
      where,
      order: { sort_order: 'ASC', created_at: 'ASC' },
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

  async findOne(id: string): Promise<ApplicationStatus> {
    const status = await this.statusRepo.findOne({ where: { id } });
    if (!status) {
      throw new NotFoundException(`Ariza statusi (ID: ${id}) topilmadi`);
    }
    return status;
  }

  async update(id: string, dto: UpdateApplicationStatusDto): Promise<ApplicationStatus> {
    const status = await this.findOne(id);

    if (dto.name && dto.name.trim() !== status.name) {
      const existing = await this.statusRepo.findOne({
        where: { name: ILike(dto.name.trim()) },
      });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`"${dto.name.trim()}" nomli status allaqachon mavjud`);
      }
      status.name = dto.name.trim();
    }

    if (dto.code) {
      status.code = dto.code.trim().toUpperCase();
    }

    if (dto.color !== undefined) {
      status.color = dto.color;
    }

    if (dto.description !== undefined) {
      status.description = dto.description;
    }

    if (dto.sort_order !== undefined) {
      status.sort_order = dto.sort_order;
    }

    if (dto.is_default !== undefined) {
      if (dto.is_default && !status.is_default) {
        await this.statusRepo.update({}, { is_default: false });
      }
      status.is_default = dto.is_default;
    }

    return this.statusRepo.save(status);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const status = await this.findOne(id);

    const appsUsing = await this.appRepo.count({ where: { status_id: id } });
    if (appsUsing > 0) {
      const fallback = await this.statusRepo.findOne({ where: { is_default: true } });
      if (fallback && fallback.id !== id) {
        await this.appRepo.update(
          { status_id: id },
          { status_id: fallback.id, status: fallback.code || fallback.name },
        );
      } else {
        await this.appRepo.update({ status_id: id }, { status_id: null });
      }
    }

    await this.statusRepo.remove(status);
    return {
      success: true,
      message: "Ariza statusi muvaffaqiyatli o'chirildi",
    };
  }
}
