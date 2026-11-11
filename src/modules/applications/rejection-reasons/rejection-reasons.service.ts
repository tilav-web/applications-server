import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RejectionReason } from './rejection-reason.entity';

@Injectable()
export class RejectionReasonsService implements OnModuleInit {
  constructor(
    @InjectRepository(RejectionReason)
    private readonly repo: Repository<RejectionReason>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async findAll(includeInactive = false): Promise<RejectionReason[]> {
    const qb = this.repo.createQueryBuilder('r').orderBy('r.name', 'ASC');
    if (!includeInactive) {
      qb.where('r.is_active = :active', { active: true });
    }
    return qb.getMany();
  }

  async findOne(id: string): Promise<RejectionReason> {
    const reason = await this.repo.findOne({ where: { id } });
    if (!reason) throw new NotFoundException('Rad etish sababi topilmadi');
    return reason;
  }

  async create(data: { name: string; is_active?: boolean }): Promise<RejectionReason> {
    const cleanName = data.name.trim();
    if (!cleanName) throw new BadRequestException('Nom kiritilishi shart');

    const existing = await this.repo
      .createQueryBuilder('r')
      .where('LOWER(r.name) = LOWER(:name)', { name: cleanName })
      .getOne();

    if (existing) return existing;

    const reason = this.repo.create({
      name: cleanName,
      is_active: data.is_active ?? true,
    });

    return this.repo.save(reason);
  }

  async update(id: string, data: { name?: string; is_active?: boolean }): Promise<RejectionReason> {
    const reason = await this.findOne(id);
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      const existing = await this.repo
        .createQueryBuilder('r')
        .where('LOWER(r.name) = LOWER(:name) AND r.id != :id', { name: cleanName, id })
        .getOne();
      if (existing) throw new BadRequestException('Bunday rad etish sababi mavjud');
      reason.name = cleanName;
    }
    if (data.is_active !== undefined) reason.is_active = data.is_active;

    return this.repo.save(reason);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const reason = await this.findOne(id);
    await this.repo.remove(reason);
    return { success: true, message: "Rad etish sababi o'chirildi" };
  }

  async seedDefaults(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;

    const defaults = [
      'Aldangan',
      'Kreditiga kesilgan',
      'Rasm tarqatish',
      'Haqorat',
      'Adashib tashlagan',
      'Pul bilan bog‘liq',
      'Boshqa holatlar',
    ];

    for (const name of defaults) {
      await this.create({ name });
    }
  }
}
