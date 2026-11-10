import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { CrimeMethod } from './crime-method.entity';
import type { CreateCrimeMethodDto } from './dto/create-crime-method.dto';
import type { UpdateCrimeMethodDto } from './dto/update-crime-method.dto';

export const DEFAULT_CRIME_METHODS = [
  {
    name: 'Сохта ҳавола/зарарли дастур орқали карта ёки қурилма бошқарувини қўлга киритиш орқали',
    group_name: 'Фишинг ва қурилма/карта бошқаруви',
    sort_order: 1,
  },
  {
    name: 'Сохта қўнғироқлар орқали алдаб, карта бошқарувини қўлга киритиш орқали',
    group_name: 'Фишинг ва қурилма/карта бошқаруви',
    sort_order: 2,
  },
  {
    name: 'Ижтимоий тармоқларда ёки онлайн савдо платформаларида “сотувчи” ёки “харидор” сифатида алдаш орқали',
    group_name: 'Онлайн савдо, хизмат ва бандлик',
    sort_order: 3,
  },
  {
    name: 'Ишга, ўқишга киритиш, юбориш алдовлари орқали',
    group_name: 'Онлайн савдо, хизмат ва бандлик',
    sort_order: 4,
  },
  {
    name: 'Сохта трейдинг ёки онлайн биржада пул кўпайтириш учун ўтказиш',
    group_name: 'Трейдинг ва инвестиция алдовлари',
    sort_order: 5,
  },
  {
    name: 'Турли соҳаларга инвестиция киритиш орқали, пулини кўпайтириб бериш алдовлари орқали',
    group_name: 'Трейдинг ва инвестиция алдовлари',
    sort_order: 6,
  },
  {
    name: 'Онлайн микро қарз ва кредит расмийлаштириш орқали',
    group_name: 'Кредит, лимит ва банк тизимлари',
    sort_order: 7,
  },
  {
    name: 'Банклар ва савдо платформалари (Узум ва б) лимит учун ажратилган пулларини алдаб, ўзлаштириш',
    group_name: 'Кредит, лимит ва банк тизимлари',
    sort_order: 8,
  },
  {
    name: 'Банклар ва тўлов ташкилотлари техник заифликлари ёки уларга боғлиқ бошқа сабаблар бн',
    group_name: 'Кредит, лимит ва банк тизимлари',
    sort_order: 9,
  },
  {
    name: 'Банклар ва тўлов ташкилот ходимлари тизимга кириб, ўз мижозлари пулини ўзлаштриши',
    group_name: 'Кредит, лимит ва банк тизимлари',
    sort_order: 10,
  },
  {
    name: 'КРОСПАЙ',
    group_name: 'Кредит, лимит ва банк тизимлари',
    sort_order: 11,
  },
  {
    name: 'Танишлари номидан соҳта аккаунт ёрдамида пўл сўраш орқали',
    group_name: 'Ижтимоий инжиниринг ва алдов',
    sort_order: 12,
  },
  {
    name: 'Мерос ёки пул, ютуқ юборишни ваъда қилиш ва хайрияларга пул сўраш шаклида',
    group_name: 'Ижтимоий инжиниринг ва алдов',
    sort_order: 13,
  },
  {
    name: 'КОМПЕНСАЦИЯ ОЛИШ УЧУН ПУЛ СЎРАШ',
    group_name: 'Ижтимоий инжиниринг ва алдов',
    sort_order: 14,
  },
  {
    name: 'Сунъий интеллект оркали расм, тасвир еки овозни сохталаштириб, фирибгарлик',
    group_name: 'Ижтимоий инжиниринг ва алдов',
    sort_order: 15,
  },
  {
    name: 'Бошқа',
    group_name: 'Бошқа',
    sort_order: 16,
  },
];

@Injectable()
export class CrimeMethodsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CrimeMethodsService.name);

  constructor(
    @InjectRepository(CrimeMethod)
    private readonly repo: Repository<CrimeMethod>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const count = await this.repo.count();
      if (count === 0) {
        this.logger.log('crime_methods bo‘sh, standart 16 ta jinoyat usuli kiritilmoqda...');
        for (const item of DEFAULT_CRIME_METHODS) {
          await this.repo.save(this.repo.create(item));
        }
        this.logger.log('Standart 16 ta jinoyat sodir etish usuli muvaffaqiyatli kiritildi.');
      } else {
        // Agar biror standart usul bo'lmasa, uni qo'shib qo'yamiz
        for (const item of DEFAULT_CRIME_METHODS) {
          const exists = await this.repo.findOne({ where: { name: item.name } });
          if (!exists) {
            await this.repo.save(this.repo.create(item));
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`crime_methods bootstrap xatosi: ${e.message}`);
    }
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<CrimeMethod>> {
    const where: FindOptionsWhere<CrimeMethod>[] = [];

    if (search && search.trim()) {
      const q = search.trim();
      where.push(
        { name: ILike(`%${q}%`) },
        { group_name: ILike(`%${q}%`) },
        { description: ILike(`%${q}%`) },
      );
    }

    const [items, total] = await this.repo.findAndCount({
      where: where.length > 0 ? where : undefined,
      order: { sort_order: 'ASC', created_at: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
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

  async findAllActive(): Promise<CrimeMethod[]> {
    return this.repo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
  }

  async findOne(id: string): Promise<CrimeMethod> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Jinoyat usuli topilmadi: ${id}`);
    }
    return item;
  }

  async create(dto: CreateCrimeMethodDto): Promise<CrimeMethod> {
    const cleanName = dto.name.trim();
    const existing = await this.repo.findOne({ where: { name: cleanName } });
    if (existing) {
      throw new BadRequestException(`"${cleanName}" usuli allaqachon mavjud`);
    }

    const entity = this.repo.create({
      ...dto,
      name: cleanName,
      group_name: (dto.group_name || 'Бошқа').trim(),
      sort_order: dto.sort_order ?? 0,
      is_active: dto.is_active ?? true,
    });

    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateCrimeMethodDto): Promise<CrimeMethod> {
    const item = await this.findOne(id);

    if (dto.name) {
      const cleanName = dto.name.trim();
      if (cleanName !== item.name) {
        const existing = await this.repo.findOne({ where: { name: cleanName } });
        if (existing && existing.id !== id) {
          throw new BadRequestException(`"${cleanName}" usuli allaqachon mavjud`);
        }
        item.name = cleanName;
      }
    }

    if (dto.group_name !== undefined) item.group_name = dto.group_name.trim();
    if (dto.code !== undefined) item.code = dto.code;
    if (dto.description !== undefined) item.description = dto.description;
    if (dto.sort_order !== undefined) item.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) item.is_active = dto.is_active;

    return this.repo.save(item);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { success: true, message: `Jinoyat usuli o‘chirildi: "${item.name}"` };
  }
}

