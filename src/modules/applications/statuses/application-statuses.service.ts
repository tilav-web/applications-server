import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { Application } from '../application.entity';
import { ApplicationStatus, ApplicationStatusCategory } from './application-status.entity';
import type { CreateApplicationStatusDto } from './dto/create-application-status.dto';
import type { UpdateApplicationStatusDto } from './dto/update-application-status.dto';

export const DEFAULT_JPK_STATUSES: Array<{
  name: string;
  code: string;
  color: string;
  description: string;
  category: ApplicationStatusCategory;
  tracks_sla: boolean;
  default_sla_days: number | null;
  legal_article: string | null;
  requires_decision: boolean;
  requires_rejection_reason: boolean;
  is_default: boolean;
  sort_order: number;
}> = [
  {
    name: 'Yangi (Qabul qilindi)',
    code: 'YANGI',
    color: 'blue',
    description: 'Yangi kelib tushgan va ro‘yxatga olingan ariza (3–10 kunlik muddat)',
    category: ApplicationStatusCategory.OPEN,
    tracks_sla: true,
    default_sla_days: 10,
    legal_article: 'JPK 329-modda',
    requires_decision: false,
    requires_rejection_reason: false,
    is_default: true,
    sort_order: 1,
  },
  {
    name: 'Tergovga qadar tekshiruvda',
    code: 'JARAYONDA',
    color: 'amber',
    description: 'Tergovga qadar tekshiruv o‘tkazilmoqda (10 sutkagacha)',
    category: ApplicationStatusCategory.IN_PROGRESS,
    tracks_sla: true,
    default_sla_days: 10,
    legal_article: 'JPK 329-modda',
    requires_decision: false,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 2,
  },
  {
    name: 'Muddati uzaytirilgan (1 oygacha)',
    code: 'MUDDATI_UZAYTIRILGAN',
    color: 'orange',
    description: 'Prokuror roziligi bilan tekshiruv muddati 1 oygacha uzaytirilgan',
    category: ApplicationStatusCategory.EXTENDED,
    tracks_sla: true,
    default_sla_days: 30,
    legal_article: 'JPK 329-modda',
    requires_decision: false,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 3,
  },
  {
    name: 'Jinoyat ishi qo‘zg‘atildi',
    code: 'JINOYAT_ISHI_QOZGATILDI',
    color: 'purple',
    description: 'Jinoyat alomatlari aniqlanib, jinoyat ishi qo‘zg‘atilgan (surishtiruv/tergovda)',
    category: ApplicationStatusCategory.IN_PROGRESS,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'JPK 330-modda 1-band',
    requires_decision: true,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 4,
  },
  {
    name: 'Tergov to‘xtatildi (Qidiruv / Noma’lum shaxs)',
    code: 'TERGOV_TOXTATILDI',
    color: 'slate',
    description: 'Shaxs aniqlanmaganligi yoki qidiruvda ekanligi sababli vaqtincha to‘xtatilgan',
    category: ApplicationStatusCategory.PAUSED,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'JPK 364-modda',
    requires_decision: false,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 5,
  },
  {
    name: 'Sudga yuborildi (Ayblov xulosasi)',
    code: 'HAL_QILINDI',
    color: 'emerald',
    description: 'Dastlabki tergov tamomlanib, prokuror orqali sudga yuborilgan',
    category: ApplicationStatusCategory.CLOSED,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'JPK 373, 381-moddalar',
    requires_decision: true,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 6,
  },
  {
    name: 'Yarashuv asosida yakunlandi',
    code: 'YARASHUV',
    color: 'teal',
    description: 'Jabrlanuvchi bilan yarashilganligi va zarar qoplanganligi sababli yakunlandi',
    category: ApplicationStatusCategory.CLOSED,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'JK 66¹-m., JPK 582-m.',
    requires_decision: true,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 7,
  },
  {
    name: 'Ma’muriy tartibga o‘tkazildi',
    code: 'MAMURIY_TARTIB',
    color: 'cyan',
    description: 'Jinoyat tarkibi yo‘q, ma’muriy huquqbuzarlik sifatida ko‘rib chiqishga yuborildi',
    category: ApplicationStatusCategory.CLOSED,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'JPK 334-modda',
    requires_decision: true,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 8,
  },
  {
    name: 'Tegishliligi bo‘yicha yuborildi',
    code: 'TEGISHLILIGI_BOYICHA',
    color: 'indigo',
    description: 'Boshqa hududiy IIB yoki vakolatli huquqni muhofaza qiluvchi organga yuborildi',
    category: ApplicationStatusCategory.CLOSED,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'JPK 330-m. 3-b. / O‘RQ-445 25-m.',
    requires_decision: true,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 9,
  },
  {
    name: 'Jinoyat ishi qo‘zg‘atish rad etildi',
    code: 'RAD_ETILDI',
    color: 'rose',
    description: 'Jinoyat hodisasi yoki tarkibi yo‘qligi yoxud boshqa asoslar bilan rad etildi',
    category: ApplicationStatusCategory.CLOSED,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'JPK 333-m. (83/84-m.)',
    requires_decision: true,
    requires_rejection_reason: true,
    is_default: false,
    sort_order: 10,
  },
  {
    name: 'Tushuntirish berildi / Ko‘rmay qoldirildi',
    code: 'TUSHUNTIRISH_BERILDI',
    color: 'gray',
    description: 'Umumiy murojaat bo‘yicha huquqiy tushuntirish berildi yoki ko‘rmay qoldirildi',
    category: ApplicationStatusCategory.CLOSED,
    tracks_sla: false,
    default_sla_days: null,
    legal_article: 'O‘RQ-445 29–30-moddalar',
    requires_decision: false,
    requires_rejection_reason: false,
    is_default: false,
    sort_order: 11,
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
      const existingCount = await this.statusRepo.count();
      const isInitialSeed = existingCount === 0;

      for (const ds of DEFAULT_JPK_STATUSES) {
        const existing = await this.statusRepo.findOne({
          where: [{ code: ds.code }, { name: ILike(ds.name) }],
        });
        if (!existing) {
          const created = this.statusRepo.create({
            ...ds,
            is_default: isInitialSeed ? ds.is_default : false,
          });
          await this.statusRepo.save(created);
        } else {
          // Mavjud statusda JPK/SLA atributlari bo'sh yoki eskirgan bo'lsa avtomatik sinxronlaymiz
          let changed = false;
          if (!existing.legal_article && ds.legal_article) {
            existing.legal_article = ds.legal_article;
            changed = true;
          }
          if (existing.category !== ds.category && existing.code === ds.code) {
            existing.category = ds.category;
            existing.tracks_sla = ds.tracks_sla;
            existing.default_sla_days = ds.default_sla_days;
            existing.requires_decision = ds.requires_decision;
            existing.requires_rejection_reason = ds.requires_rejection_reason;
            changed = true;
          }
          if (changed) {
            await this.statusRepo.save(existing);
          }
        }
      }

      // Kamida bitta default status mavjudligini ta'minlash
      const hasDefault = await this.statusRepo.findOne({ where: { is_default: true } });
      if (!hasDefault) {
        const firstOpen = await this.statusRepo.findOne({
          where: [{ code: 'YANGI' }, { category: ApplicationStatusCategory.OPEN }],
          order: { sort_order: 'ASC' },
        });
        if (firstOpen) {
          firstOpen.is_default = true;
          await this.statusRepo.save(firstOpen);
        }
      }

      // Mavjud arizalarda status_id bo'sh bo'lsa, ularga mos status_id ni bog'laymiz
      const allStatuses = await this.statusRepo.find();
      const defaultStatus = allStatuses.find((s) => s.is_default) || allStatuses[0];
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

    const code = dto.code
      ? dto.code.trim().toUpperCase()
      : trimmedName
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, '_')
          .slice(0, 50);

    const category = dto.category || ApplicationStatusCategory.OPEN;
    const isClosedOrPaused =
      category === ApplicationStatusCategory.CLOSED ||
      category === ApplicationStatusCategory.PAUSED;

    return this.statusRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ApplicationStatus);
      if (dto.is_default) {
        await repo.update({ is_default: true }, { is_default: false });
      }

      const status = repo.create({
        ...dto,
        name: trimmedName,
        code,
        color: dto.color || 'blue',
        category,
        tracks_sla: dto.tracks_sla !== undefined ? dto.tracks_sla : !isClosedOrPaused,
        default_sla_days:
          dto.default_sla_days !== undefined ? dto.default_sla_days : isClosedOrPaused ? null : 10,
        legal_article: dto.legal_article?.trim() || null,
        requires_decision: Boolean(dto.requires_decision),
        requires_rejection_reason: Boolean(dto.requires_rejection_reason),
        is_default: Boolean(dto.is_default),
        sort_order: dto.sort_order ?? 0,
      });

      return repo.save(status);
    });
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
      where = [{ name: ILike(q) }, { code: ILike(q) }, { legal_article: ILike(q) }];
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

    if (dto.code) status.code = dto.code.trim().toUpperCase();
    if (dto.color !== undefined) status.color = dto.color;
    if (dto.description !== undefined) status.description = dto.description;
    if (dto.category !== undefined) status.category = dto.category;
    if (dto.tracks_sla !== undefined) status.tracks_sla = dto.tracks_sla;
    if (dto.default_sla_days !== undefined) status.default_sla_days = dto.default_sla_days;
    if (dto.legal_article !== undefined) status.legal_article = dto.legal_article?.trim() || null;
    if (dto.requires_decision !== undefined) status.requires_decision = dto.requires_decision;
    if (dto.requires_rejection_reason !== undefined) {
      status.requires_rejection_reason = dto.requires_rejection_reason;
    }
    if (dto.sort_order !== undefined) status.sort_order = dto.sort_order;

    return this.statusRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ApplicationStatus);
      if (dto.is_default !== undefined) {
        if (dto.is_default && !status.is_default) {
          await repo.update({ is_default: true }, { is_default: false });
        }
        status.is_default = dto.is_default;
      }

      return repo.save(status);
    });
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const status = await this.findOne(id);

    if (status.is_default) {
      throw new ConflictException(
        `«${status.name}» boshlang‘ich (default) status hisoblanadi va uni o‘chirib bo‘lmaydi. Avval boshqa statusni default qilib belgilang.`,
      );
    }

    await assertNoDependencies(this.statusRepo.manager, `«${status.name}» statusi`, status.id, [
      {
        table: 'applications',
        column: 'status_id',
        label: 'ariza',
        extraWhere: 'is_deleted = false',
      },
      {
        table: 'detected_crimes',
        column: 'status_id',
        label: 'aniqlangan jinoyat',
        extraWhere: 'is_deleted = false',
      },
    ]);

    await this.statusRepo.remove(status);
    return {
      success: true,
      message: "Ariza statusi muvaffaqiyatli o'chirildi",
    };
  }
}
