import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import { AwarenessStatus } from './awareness-status.entity';

const DEFAULT_AWARENESS_STATUSES: Array<{
  name: string;
  code: string;
  is_informed: boolean;
  source_channel: string | null;
  sort_order: number;
}> = [
  {
    name: 'Qilinmagan',
    code: 'NOT_INFORMED',
    is_informed: false,
    source_channel: null,
    sort_order: 1,
  },
  {
    name: "IIB targ'ibot qilgan, bilmasdan bosgan yoki tashlab bergan",
    code: 'IIB_ACCIDENTAL',
    is_informed: true,
    source_channel: 'IIB',
    sort_order: 2,
  },
  {
    name: "IIB targ'ibot qilgan, farzandi bosib qo'ygan",
    code: 'IIB_CHILD',
    is_informed: true,
    source_channel: 'IIB',
    sort_order: 3,
  },
  {
    name: "Onlayn targ'ibot tanishgan, bilmasdan bosgan yoki tashlab bergan",
    code: 'ONLINE_ACCIDENTAL',
    is_informed: true,
    source_channel: 'Onlayn',
    sort_order: 4,
  },
  {
    name: "Onlayn targ'ibot tanishgan, farzandi bosib qo'ygan",
    code: 'ONLINE_CHILD',
    is_informed: true,
    source_channel: 'Onlayn',
    sort_order: 5,
  },
];

@Injectable()
export class AwarenessStatusesService implements OnModuleInit {
  constructor(
    @InjectRepository(AwarenessStatus)
    private readonly repo: Repository<AwarenessStatus>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    try {
      const count = await this.repo.count();
      if (count > 0) return;

      for (const item of DEFAULT_AWARENESS_STATUSES) {
        await this.repo.save(
          this.repo.create({
            ...item,
            is_active: true,
          }),
        );
      }
    } catch {
      // Migratsiya hali ishga tushmagan bo'lishi mumkin
    }
  }

  async findAll(includeInactive = false): Promise<AwarenessStatus[]> {
    return this.repo.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<AwarenessStatus> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("Targ'ibot holati topilmadi");
    return item;
  }

  async create(data: {
    name: string;
    code?: string | null;
    is_informed?: boolean;
    source_channel?: string | null;
    sort_order?: number;
    is_active?: boolean;
  }): Promise<AwarenessStatus> {
    const cleanName = (data.name || '').trim();
    if (!cleanName) throw new BadRequestException("Targ'ibot holati nomi kiritilishi shart");

    const existing = await this.repo.findOne({ where: { name: ILike(cleanName) } });
    if (existing) {
      throw new BadRequestException(`«${cleanName}» targ'ibot holati allaqachon mavjud`);
    }

    const cleanCode = data.code?.trim() ? data.code.trim().toUpperCase().slice(0, 60) : null;
    if (cleanCode) {
      const dupCode = await this.repo.findOne({ where: { code: cleanCode } });
      if (dupCode) {
        throw new BadRequestException(`«${cleanCode}» kodli targ'ibot holati allaqachon mavjud`);
      }
    }

    const isInformed = data.is_informed ?? true;
    const entity = this.repo.create({
      name: cleanName,
      code: cleanCode,
      is_informed: isInformed,
      source_channel: isInformed ? data.source_channel?.trim() || null : null,
      sort_order: data.sort_order ?? 10,
      is_active: data.is_active ?? true,
    });
    return this.repo.save(entity);
  }

  async update(
    id: string,
    data: {
      name?: string;
      code?: string | null;
      is_informed?: boolean;
      source_channel?: string | null;
      sort_order?: number;
      is_active?: boolean;
    },
  ): Promise<AwarenessStatus> {
    const item = await this.findOne(id);

    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      if (!cleanName) throw new BadRequestException("Nom bo'sh bo'lishi mumkin emas");
      const dup = await this.repo.findOne({ where: { name: ILike(cleanName) } });
      if (dup && dup.id !== id) {
        throw new BadRequestException(`«${cleanName}» targ'ibot holati allaqachon mavjud`);
      }
      item.name = cleanName;
    }

    if (data.code !== undefined) {
      const cleanCode = data.code?.trim() ? data.code.trim().toUpperCase().slice(0, 60) : null;
      if (cleanCode) {
        const dupCode = await this.repo.findOne({ where: { code: cleanCode } });
        if (dupCode && dupCode.id !== id) {
          throw new BadRequestException(`«${cleanCode}» kodli targ'ibot holati allaqachon mavjud`);
        }
      }
      item.code = cleanCode;
    }

    if (data.is_informed !== undefined) {
      item.is_informed = Boolean(data.is_informed);
      if (!item.is_informed) {
        item.source_channel = null;
      }
    }

    if (data.source_channel !== undefined) {
      item.source_channel = item.is_informed ? data.source_channel?.trim() || null : null;
    }

    if (data.sort_order !== undefined) item.sort_order = Number(data.sort_order) || 0;
    if (data.is_active !== undefined) item.is_active = Boolean(data.is_active);

    return this.repo.save(item);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findOne(id);
    await assertNoDependencies(this.repo.manager, `«${item.name}» targ'ibot holati`, item.id, [
      {
        table: 'applications',
        column: 'awareness_status_id',
        label: 'ariza',
        extraWhere: 'is_deleted = false',
      },
    ]);
    await this.repo.remove(item);
    return { success: true, message: "Targ'ibot holati o'chirildi" };
  }
}
