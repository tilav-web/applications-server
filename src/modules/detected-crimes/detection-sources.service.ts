import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertNoDependencies } from '../../common/database/dependency-guard.util';
import { DetectionSource } from './entities/detection-source.entity';

const DEFAULT_DETECTION_SOURCES = [
  {
    name: 'Kiber-monitoring (Ijtimoiy tarmoqlar / Telegram)',
    code: 'CYBER_MONITORING',
    description:
      'Telegram, Instagram, TikTok, saytlar va ochiq tarmoqlarni monitoring qilish orqali',
    sort_order: 1,
  },
  {
    name: 'Tezkor-qidiruv tadbiri (TQT)',
    code: 'OPERATIONAL_SEARCH',
    description:
      'O‘RQ-344 «Tezkor-qidiruv faoliyati to‘g‘risida»gi Qonun asosida o‘tkazilgan tadbir',
    sort_order: 2,
  },
  {
    name: 'OAV / Ochiq manbalar xabari',
    code: 'MEDIA_REPORT',
    description:
      'JPK 327-modda bo‘yicha ommaviy axborot vositalari va ijtimoiy tarmoqlardagi xabarlar',
    sort_order: 3,
  },
  {
    name: 'Boshqa jinoyat ishi doirasida aniqlangan',
    code: 'RELATED_INVESTIGATION',
    description: 'Tergov yoki surishtiruv jarayonida qo‘shimcha epizod sifatida fosh etilgan',
    sort_order: 4,
  },
  {
    name: 'Idoralararo / Xalqaro xabar',
    code: 'INTERAGENCY',
    description: 'Prokuratura, DXX, bank, kripto-birja yoki xalqaro so‘rov orqali olingan ma’lumot',
    sort_order: 5,
  },
];

@Injectable()
export class DetectionSourcesService implements OnModuleInit {
  constructor(
    @InjectRepository(DetectionSource)
    private readonly repo: Repository<DetectionSource>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    try {
      const count = await this.repo.count();
      if (count > 0) return;
      for (const item of DEFAULT_DETECTION_SOURCES) {
        await this.repo.save(this.repo.create({ ...item, is_active: true }));
      }
    } catch {
      // ignore seed errors during early init
    }
  }

  async findAll(includeInactive = false): Promise<DetectionSource[]> {
    const qb = this.repo
      .createQueryBuilder('ds')
      .orderBy('ds.sort_order', 'ASC')
      .addOrderBy('ds.name', 'ASC');
    if (!includeInactive) {
      qb.where('ds.is_active = :active', { active: true });
    }
    return qb.getMany();
  }

  async findOne(id: string): Promise<DetectionSource> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Aniqlash usuli topilmadi');
    return item;
  }

  async create(data: {
    name: string;
    code?: string;
    description?: string;
    sort_order?: number;
    is_active?: boolean;
  }): Promise<DetectionSource> {
    const cleanName = (data.name || '').trim();
    if (!cleanName) throw new BadRequestException('Nom kiritilishi shart');

    const existing = await this.repo
      .createQueryBuilder('ds')
      .where('LOWER(ds.name) = LOWER(:name)', { name: cleanName })
      .getOne();
    if (existing) throw new BadRequestException(`«${cleanName}» allaqachon mavjud`);

    return this.repo.save(
      this.repo.create({
        name: cleanName,
        code: data.code?.trim().toUpperCase() || null,
        description: data.description?.trim() || null,
        sort_order: data.sort_order ?? 10,
        is_active: data.is_active ?? true,
      }),
    );
  }

  async update(
    id: string,
    data: {
      name?: string;
      code?: string;
      description?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ): Promise<DetectionSource> {
    const item = await this.findOne(id);
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      if (!cleanName) throw new BadRequestException('Nom bo‘sh bo‘lishi mumkin emas');
      const dup = await this.repo
        .createQueryBuilder('ds')
        .where('LOWER(ds.name) = LOWER(:name) AND ds.id != :id', { name: cleanName, id })
        .getOne();
      if (dup) throw new BadRequestException(`«${cleanName}» allaqachon mavjud`);
      item.name = cleanName;
    }
    if (data.code !== undefined) item.code = data.code?.trim().toUpperCase() || null;
    if (data.description !== undefined) item.description = data.description?.trim() || null;
    if (data.sort_order !== undefined) item.sort_order = Number(data.sort_order) || 0;
    if (data.is_active !== undefined) item.is_active = Boolean(data.is_active);
    return this.repo.save(item);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findOne(id);
    await assertNoDependencies(this.repo.manager, `«${item.name}» aniqlash usuli`, item.id, [
      {
        table: 'detected_crimes',
        column: 'detection_source_id',
        label: 'aniqlangan jinoyat',
        extraWhere: 'is_deleted = false',
      },
    ]);
    await this.repo.remove(item);
    return { success: true, message: "Aniqlash usuli muvaffaqiyatli o'chirildi" };
  }
}
