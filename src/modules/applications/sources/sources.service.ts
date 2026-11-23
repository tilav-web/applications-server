import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import { ApplicationSource } from './application-source.entity';

@Injectable()
export class ApplicationSourcesService implements OnModuleInit {
  constructor(
    @InjectRepository(ApplicationSource)
    private readonly repo: Repository<ApplicationSource>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async findAll(includeInactive = false): Promise<ApplicationSource[]> {
    const qb = this.repo.createQueryBuilder('s').orderBy('s.name', 'ASC');
    if (!includeInactive) {
      qb.where('s.is_active = :active', { active: true });
    }
    return qb.getMany();
  }

  async findOne(id: string): Promise<ApplicationSource> {
    const source = await this.repo.findOne({ where: { id } });
    if (!source) throw new NotFoundException('Murojaat manbasi topilmadi');
    return source;
  }

  async create(data: {
    name: string;
    code?: string;
    is_active?: boolean;
  }): Promise<ApplicationSource> {
    const cleanName = data.name.trim();
    if (!cleanName) throw new BadRequestException('Nom kiritilishi shart');

    const existing = await this.repo
      .createQueryBuilder('s')
      .where('LOWER(s.name) = LOWER(:name)', { name: cleanName })
      .getOne();

    if (existing) return existing;

    const source = this.repo.create({
      name: cleanName,
      code: data.code?.trim() || null,
      is_active: data.is_active ?? true,
    });

    return this.repo.save(source);
  }

  async update(
    id: string,
    data: { name?: string; code?: string; is_active?: boolean },
  ): Promise<ApplicationSource> {
    const source = await this.findOne(id);
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      const existing = await this.repo
        .createQueryBuilder('s')
        .where('LOWER(s.name) = LOWER(:name) AND s.id != :id', { name: cleanName, id })
        .getOne();
      if (existing) throw new BadRequestException('Bunday manba mavjud');
      source.name = cleanName;
    }
    if (data.code !== undefined) source.code = data.code?.trim() || null;
    if (data.is_active !== undefined) source.is_active = data.is_active;

    return this.repo.save(source);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const source = await this.findOne(id);
    await assertNoDependencies(this.repo.manager, `«${source.name}» murojaat manbasi`, source.id, [
      {
        table: 'applications',
        column: 'source_id',
        label: 'ariza',
        extraWhere: 'is_deleted = false',
      },
    ]);
    await this.repo.remove(source);
    return { success: true, message: "Murojaat manbasi o'chirildi" };
  }

  async seedDefaults(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;

    const defaultSources = [
      { name: '102 xizmati', code: '102' },
      { name: '112 xizmati', code: '112' },
      { name: 'Ishonch telefoni', code: 'HOTLINE' },
      { name: 'Bevosita / yozma murojaat', code: 'DIRECT' },
      { name: 'Elektron portal (my.gov.uz)', code: 'PORTAL' },
      { name: 'Boshqa idoradan kelib tushgan', code: 'OTHER' },
    ];

    for (const s of defaultSources) {
      await this.create(s);
    }
  }
}
