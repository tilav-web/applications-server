import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import { ExternalSystem } from './external-system.entity';

const DEFAULT_EXTERNAL_SYSTEMS: Array<{
  name: string;
  code: string;
  description: string;
  color: string;
  sort_order: number;
}> = [
  {
    name: 'CardBlock',
    code: 'CARDBLOCK',
    description: 'Bank kartalarini bloklash va kuzatish tizimi',
    color: '#2563EB',
    sort_order: 1,
  },
  {
    name: 'E-Elektron',
    code: 'E_ELEKTRON',
    description: 'Elektron hujjat aylanishi va hisob tizimi',
    color: '#7C3AED',
    sort_order: 2,
  },
  {
    name: 'E-Material',
    code: 'E_MATERIAL',
    description: 'Elektron tergovga qadar tekshiruv materiallari tizimi',
    color: '#0891B2',
    sort_order: 3,
  },
  {
    name: 'CyberControl',
    code: 'CYBERCONTROL',
    description: 'Kiberjinoyatlar monitoring va tahlil tizimi',
    color: '#059669',
    sort_order: 4,
  },
];

@Injectable()
export class ExternalSystemsService implements OnModuleInit {
  constructor(
    @InjectRepository(ExternalSystem)
    private readonly repo: Repository<ExternalSystem>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    try {
      const count = await this.repo.count();
      if (count > 0) return;

      for (const item of DEFAULT_EXTERNAL_SYSTEMS) {
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

  async findAll(includeInactive = false): Promise<ExternalSystem[]> {
    return this.repo.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<ExternalSystem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Tashqi tizim topilmadi');
    return item;
  }

  async create(data: {
    name: string;
    code?: string | null;
    description?: string | null;
    color?: string | null;
    sort_order?: number;
    is_active?: boolean;
  }): Promise<ExternalSystem> {
    const cleanName = (data.name || '').trim();
    if (!cleanName) throw new BadRequestException('Tizim nomi kiritilishi shart');

    const existing = await this.repo.findOne({ where: { name: ILike(cleanName) } });
    if (existing) {
      throw new BadRequestException(`«${cleanName}» tashqi tizimi allaqachon mavjud`);
    }

    const cleanCode = data.code?.trim() ? data.code.trim().toUpperCase().slice(0, 60) : null;
    if (cleanCode) {
      const dupCode = await this.repo.findOne({ where: { code: cleanCode } });
      if (dupCode) {
        throw new BadRequestException(`«${cleanCode}» kodli tashqi tizim allaqachon mavjud`);
      }
    }

    const entity = this.repo.create({
      name: cleanName,
      code: cleanCode,
      description: data.description?.trim() || null,
      color: data.color?.trim() || '#2563EB',
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
      description?: string | null;
      color?: string | null;
      sort_order?: number;
      is_active?: boolean;
    },
  ): Promise<ExternalSystem> {
    const item = await this.findOne(id);

    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      if (!cleanName) throw new BadRequestException("Tizim nomi bo'sh bo'lishi mumkin emas");
      const dup = await this.repo.findOne({ where: { name: ILike(cleanName) } });
      if (dup && dup.id !== id) {
        throw new BadRequestException(`«${cleanName}» tashqi tizimi allaqachon mavjud`);
      }
      item.name = cleanName;
    }

    if (data.code !== undefined) {
      const cleanCode = data.code?.trim() ? data.code.trim().toUpperCase().slice(0, 60) : null;
      if (cleanCode) {
        const dupCode = await this.repo.findOne({ where: { code: cleanCode } });
        if (dupCode && dupCode.id !== id) {
          throw new BadRequestException(`«${cleanCode}» kodli tashqi tizim allaqachon mavjud`);
        }
      }
      item.code = cleanCode;
    }

    if (data.description !== undefined) {
      item.description = data.description?.trim() || null;
    }
    if (data.color !== undefined) {
      item.color = data.color?.trim() || '#2563EB';
    }
    if (data.sort_order !== undefined) {
      item.sort_order = Number(data.sort_order) || 0;
    }
    if (data.is_active !== undefined) {
      item.is_active = Boolean(data.is_active);
    }

    return this.repo.save(item);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findOne(id);
    await assertNoDependencies(this.repo.manager, `«${item.name}» tashqi tizimi`, item.id, [
      {
        table: 'application_external_systems',
        column: 'external_system_id',
        label: 'ariza',
        extraWhere:
          'EXISTS (SELECT 1 FROM "applications" a WHERE a.id = "application_external_systems"."application_id" AND a.is_deleted = false)',
      },
    ]);
    await this.repo.remove(item);
    return { success: true, message: "Tashqi tizim o'chirildi" };
  }
}
