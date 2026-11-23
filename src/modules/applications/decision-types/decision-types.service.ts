import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import { DecisionType } from './decision-type.entity';

@Injectable()
export class DecisionTypesService implements OnModuleInit {
  constructor(
    @InjectRepository(DecisionType)
    private readonly repo: Repository<DecisionType>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async findAll(includeInactive = false): Promise<DecisionType[]> {
    const qb = this.repo.createQueryBuilder('d').orderBy('d.name', 'ASC');
    if (!includeInactive) {
      qb.where('d.is_active = :active', { active: true });
    }
    return qb.getMany();
  }

  async findOne(id: string): Promise<DecisionType> {
    const dt = await this.repo.findOne({ where: { id } });
    if (!dt) throw new NotFoundException('Qaror turi topilmadi');
    return dt;
  }

  async create(data: { name: string; is_active?: boolean }): Promise<DecisionType> {
    const cleanName = data.name.trim();
    if (!cleanName) throw new BadRequestException('Nom kiritilishi shart');

    const existing = await this.repo
      .createQueryBuilder('d')
      .where('LOWER(d.name) = LOWER(:name)', { name: cleanName })
      .getOne();

    if (existing) return existing;

    const dt = this.repo.create({
      name: cleanName,
      is_active: data.is_active ?? true,
    });

    return this.repo.save(dt);
  }

  async update(id: string, data: { name?: string; is_active?: boolean }): Promise<DecisionType> {
    const dt = await this.findOne(id);
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      const existing = await this.repo
        .createQueryBuilder('d')
        .where('LOWER(d.name) = LOWER(:name) AND d.id != :id', { name: cleanName, id })
        .getOne();
      if (existing) throw new BadRequestException('Bunday qaror turi mavjud');
      dt.name = cleanName;
    }
    if (data.is_active !== undefined) dt.is_active = data.is_active;

    return this.repo.save(dt);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const dt = await this.findOne(id);
    await assertNoDependencies(this.repo.manager, `«${dt.name}» qaror turi`, dt.id, [
      {
        table: 'applications',
        column: 'decision_type_id',
        label: 'ariza',
        extraWhere: 'is_deleted = false',
      },
    ]);
    await this.repo.remove(dt);
    return { success: true, message: "Qaror turi o'chirildi" };
  }

  async seedDefaults(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;

    const defaults = [
      'Jinoyat ishi qo‘zg‘atilgan (Х/Й)',
      'Boshqa jinoyat ishlariga qo‘shilgan',
      'Boshqa hududiy bo‘yicha yuborilgan',
      'Materiallarga birlashtirilgan',
      'Rad etilgan',
    ];

    for (const name of defaults) {
      await this.create({ name });
    }
  }
}
