import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../common/database/dependency-guard.util';
import { DetectedCrimeStatus } from './entities/detected-crime-status.entity';

const DEFAULT_DETECTED_CRIME_STATUSES = [
  {
    name: 'Fosh etildi (Qayd etildi)',
    code: 'FOSH_ETILDI',
    color: 'rose',
    is_default: true,
    is_final: false,
    sort_order: 1,
  },
  {
    name: 'Hujjatlashtirilmoqda / Ekspertizada',
    code: 'HUJJATLASHTIRILMOQDA',
    color: 'amber',
    is_default: false,
    is_final: false,
    sort_order: 2,
  },
  {
    name: 'Tergovga yuborildi (JI qo‘zg‘atildi)',
    code: 'TERGOVGA_YUBORILDI',
    color: 'blue',
    is_default: false,
    is_final: false,
    sort_order: 3,
  },
  {
    name: 'Ma’muriy tartibda sudga yuborildi (MJTK)',
    code: 'SUDGA_YUBORILDI',
    color: 'purple',
    is_default: false,
    is_final: false,
    sort_order: 4,
  },
  {
    name: 'Boshqa organga o‘tkazildi (DXX / Prokuratura / IIB)',
    code: 'BOSHQA_ORGANGA',
    color: 'indigo',
    is_default: false,
    is_final: false,
    sort_order: 5,
  },
  {
    name: 'Sud qarori chiqdi (Yakunlandi)',
    code: 'YAKUNLANDI',
    color: 'emerald',
    is_default: false,
    is_final: true,
    sort_order: 6,
  },
];

@Injectable()
export class DetectedCrimeStatusesService implements OnModuleInit {
  constructor(
    @InjectRepository(DetectedCrimeStatus)
    private readonly repo: Repository<DetectedCrimeStatus>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const item of DEFAULT_DETECTED_CRIME_STATUSES) {
        const existing = await this.repo.findOne({
          where: [{ code: item.code }, { name: ILike(item.name) }],
        });
        if (!existing) {
          await this.repo.save(this.repo.create({ ...item, is_active: true }));
        }
      }
    } catch {
      // migration hali ishga tushmagan bo'lishi mumkin
    }
  }

  async findAll(includeInactive = false): Promise<DetectedCrimeStatus[]> {
    return this.repo.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  async create(dto: {
    name: string;
    code?: string;
    color?: string;
    is_default?: boolean;
    is_final?: boolean;
    sort_order?: number;
    is_active?: boolean;
  }): Promise<DetectedCrimeStatus> {
    const name = (dto.name || '').trim();
    if (!name) throw new BadRequestException('Status nomi kiritilishi shart');

    const code = (dto.code || name)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 55);

    const dup = await this.repo.findOne({ where: [{ name: ILike(name) }, { code }] });
    if (dup) throw new ConflictException(`«${name}» statusi allaqachon mavjud`);

    if (dto.is_default) {
      await this.repo.update({ is_default: true }, { is_default: false });
    }

    const entity = this.repo.create({
      name,
      code: code || `ST_${Date.now()}`,
      color: dto.color || 'blue',
      is_default: dto.is_default ?? false,
      is_final: dto.is_final ?? false,
      sort_order: dto.sort_order ?? 10,
      is_active: dto.is_active ?? true,
    });
    return this.repo.save(entity);
  }

  async update(
    id: string,
    dto: {
      name?: string;
      code?: string;
      color?: string;
      is_default?: boolean;
      is_final?: boolean;
      sort_order?: number;
      is_active?: boolean;
    },
  ): Promise<DetectedCrimeStatus> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Status topilmadi');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Status nomi bo‘sh bo‘lishi mumkin emas');
      const dup = await this.repo.findOne({ where: { name: ILike(name) } });
      if (dup && dup.id !== id) throw new ConflictException(`«${name}» statusi allaqachon mavjud`);
      item.name = name;
    }
    if (dto.code !== undefined && dto.code.trim()) {
      item.code = dto.code.trim().toUpperCase();
    }
    if (dto.color !== undefined) item.color = dto.color;
    if (dto.is_final !== undefined) item.is_final = dto.is_final;
    if (dto.sort_order !== undefined) item.sort_order = Number(dto.sort_order) || 0;
    if (dto.is_active !== undefined) item.is_active = dto.is_active;
    if (dto.is_default !== undefined) {
      if (dto.is_default) {
        await this.repo.update({ is_default: true }, { is_default: false });
      }
      item.is_default = dto.is_default;
    }

    return this.repo.save(item);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Status topilmadi');

    await assertNoDependencies(this.repo.manager, `«${item.name}» statusi`, item.id, [
      {
        table: 'detected_crimes',
        column: 'crime_status_id',
        label: 'aniqlangan jinoyat',
        extraWhere: 'is_deleted = false',
      },
    ]);

    await this.repo.remove(item);
    return { success: true, message: 'Status muvaffaqiyatli o‘chirildi' };
  }
}
