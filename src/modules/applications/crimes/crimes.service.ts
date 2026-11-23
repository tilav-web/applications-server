import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { formatTitleCase } from '../../../common/utils/name-formatter.util';
import { Crime } from './crime.entity';
import type { CreateCrimeDto } from './dto/create-crime.dto';
import type { UpdateCrimeDto } from './dto/update-crime.dto';

const DEFAULT_CRIMES = [
  'Фирибгарлик',
  'Ўғрилик',
  'Ҳақорат қилиш',
  'Расм тарқатиш',
  'Бошқа',
  'Адашиб ташлаган',
];

@Injectable()
export class CrimesService implements OnModuleInit {
  constructor(
    @InjectRepository(Crime)
    private readonly crimeRepo: Repository<Crime>,
  ) {}

  async onModuleInit() {
    for (const name of DEFAULT_CRIMES) {
      const existing = await this.crimeRepo.findOne({
        where: [{ article: ILike(name) }, { title: ILike(name) }],
      });
      if (!existing) {
        await this.crimeRepo.save(
          this.crimeRepo.create({
            article: name,
            title: name,
          }),
        );
      }
    }
  }

  async create(dto: CreateCrimeDto): Promise<Crime> {
    const article = dto.article ? formatTitleCase(dto.article) : '';
    const crime = this.crimeRepo.create({
      ...dto,
      article,
      title: dto.title ? formatTitleCase(dto.title) : article,
    });
    return this.crimeRepo.save(crime);
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<Crime>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Crime> | FindOptionsWhere<Crime>[] = {};
    if (search) {
      const q = `%${search}%`;
      where = [{ article: ILike(q) }, { title: ILike(q) }, { category: ILike(q) }];
    }

    const [items, total] = await this.crimeRepo.findAndCount({
      where,
      order: { article: 'ASC' },
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

  async findOne(id: string): Promise<Crime> {
    const crime = await this.crimeRepo.findOne({
      where: { id },
      relations: { applications: true },
    });

    if (!crime) {
      throw new NotFoundException(`Jinoyat moddasi (ID: ${id}) topilmadi`);
    }

    return crime;
  }

  async update(id: string, dto: UpdateCrimeDto): Promise<Crime> {
    const crime = await this.findOne(id);
    const updatedData: Partial<Crime> = { ...dto };
    if (dto.article !== undefined) {
      updatedData.article = dto.article ? formatTitleCase(dto.article) : '';
    }
    if (dto.title !== undefined) {
      updatedData.title = dto.title
        ? formatTitleCase(dto.title)
        : updatedData.article || crime.article;
    }
    Object.assign(crime, updatedData);
    return this.crimeRepo.save(crime);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const crime = await this.findOne(id);
    await assertNoDependencies(
      this.crimeRepo.manager,
      `«${crime.article}» jinoyat moddasi`,
      crime.id,
      [
        {
          table: 'applications',
          column: 'crime_id',
          label: 'ariza',
          extraWhere: 'is_deleted = false',
        },
      ],
    );
    await this.crimeRepo.remove(crime);
    return {
      success: true,
      message: "Jinoyat moddasi muvaffaqiyatli o'chirildi",
    };
  }
}
