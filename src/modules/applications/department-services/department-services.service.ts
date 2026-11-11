import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DepartmentService } from './department-service.entity';

@Injectable()
export class DepartmentServicesService implements OnModuleInit {
  constructor(
    @InjectRepository(DepartmentService)
    private readonly repo: Repository<DepartmentService>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async findAll(includeInactive = false): Promise<DepartmentService[]> {
    const qb = this.repo.createQueryBuilder('d').orderBy('d.name', 'ASC');
    if (!includeInactive) {
      qb.where('d.is_active = :active', { active: true });
    }
    return qb.getMany();
  }

  async findOne(id: string): Promise<DepartmentService> {
    const ds = await this.repo.findOne({ where: { id } });
    if (!ds) throw new NotFoundException('Sohaviy xizmat topilmadi');
    return ds;
  }

  async create(data: {
    name: string;
    short_name?: string;
    is_active?: boolean;
  }): Promise<DepartmentService> {
    const cleanName = data.name.trim();
    if (!cleanName) throw new BadRequestException('Nom kiritilishi shart');

    const existing = await this.repo
      .createQueryBuilder('d')
      .where('LOWER(d.name) = LOWER(:name)', { name: cleanName })
      .getOne();

    if (existing) return existing;

    const ds = this.repo.create({
      name: cleanName,
      short_name: data.short_name?.trim() || null,
      is_active: data.is_active ?? true,
    });

    return this.repo.save(ds);
  }

  async update(
    id: string,
    data: { name?: string; short_name?: string; is_active?: boolean },
  ): Promise<DepartmentService> {
    const ds = await this.findOne(id);
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      const existing = await this.repo
        .createQueryBuilder('d')
        .where('LOWER(d.name) = LOWER(:name) AND d.id != :id', { name: cleanName, id })
        .getOne();
      if (existing) throw new BadRequestException('Bunday xizmat allaqachon mavjud');
      ds.name = cleanName;
    }
    if (data.short_name !== undefined) ds.short_name = data.short_name?.trim() || null;
    if (data.is_active !== undefined) ds.is_active = data.is_active;

    return this.repo.save(ds);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const ds = await this.findOne(id);
    await this.repo.remove(ds);
    return { success: true, message: "Sohaviy xizmat o'chirildi" };
  }

  async seedDefaults(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;

    const defaults = [
      { name: 'Uyushgan jinoyatchilikka qarshi kurashish xizmati', short_name: 'UYOKK' },
      { name: 'Jinoyat qidiruv xizmati', short_name: 'JQK' },
      { name: 'Terrorizmga qarshi kurashish xizmati', short_name: 'TQK' },
      { name: 'Huquqbuzarliklar profilaktikasi xizmati', short_name: 'HQPX' },
      { name: 'Yo‘l harakati xavfsizligi xizmati', short_name: 'YHX' },
      { name: 'Jamoat tartibini saqlash xizmati', short_name: 'JTSX' },
      { name: 'Probatsiya xizmati', short_name: 'Probatsiya' },
      { name: 'Ma’naviy-ma’rifiy ishlar xizmati', short_name: 'MMIX' },
    ];

    for (const d of defaults) {
      await this.create(d);
    }
  }
}
