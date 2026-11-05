import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { Citizen } from './citizen.entity';
import type { CreateCitizenDto } from './dto/create-citizen.dto';
import type { UpdateCitizenDto } from './dto/update-citizen.dto';

@Injectable()
export class CitizensService {
  constructor(
    @InjectRepository(Citizen)
    private readonly citizenRepo: Repository<Citizen>,
  ) {}

  async create(dto: CreateCitizenDto): Promise<Citizen> {
    const citizen = this.citizenRepo.create(dto);
    return this.citizenRepo.save(citizen);
  }

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    filters?: {
      firstName?: string;
      lastName?: string;
      middleName?: string;
      passport?: string;
      phoneNumber?: string;
      pinfl?: string;
    },
  ): Promise<PaginatedResult<Citizen>> {
    const take = limit;
    const skip = (page - 1) * limit;

    const conditions: FindOptionsWhere<Citizen> = {};
    if (filters?.firstName?.trim()) {
      conditions.first_name = ILike(`%${filters.firstName.trim()}%`);
    }
    if (filters?.lastName?.trim()) {
      conditions.last_name = ILike(`%${filters.lastName.trim()}%`);
    }
    if (filters?.middleName?.trim()) {
      conditions.middle_name = ILike(`%${filters.middleName.trim()}%`);
    }
    if (filters?.passport?.trim()) {
      conditions.passport = ILike(`%${filters.passport.trim()}%`);
    }
    if (filters?.phoneNumber?.trim()) {
      conditions.phone_number = ILike(`%${filters.phoneNumber.trim()}%`);
    }
    if (filters?.pinfl?.trim()) {
      conditions.pinfl = ILike(`%${filters.pinfl.trim()}%`);
    }

    let where: FindOptionsWhere<Citizen> | FindOptionsWhere<Citizen>[] = conditions;

    if (Object.keys(conditions).length === 0 && search?.trim()) {
      const q = `%${search.trim()}%`;
      where = [
        { first_name: ILike(q) },
        { last_name: ILike(q) },
        { middle_name: ILike(q) },
        { passport: ILike(q) },
        { phone_number: ILike(q) },
        { pinfl: ILike(q) },
      ];
    }

    const [items, total] = await this.citizenRepo.findAndCount({
      where,
      relations: { cards: true, district: true, mahalla: true },
      order: { created_at: 'DESC' },
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

  async findOne(id: string): Promise<Citizen> {
    const citizen = await this.citizenRepo.findOne({
      where: { id },
      relations: { cards: true, applications: true, district: true, mahalla: true },
    });

    if (!citizen) {
      throw new NotFoundException(`Fuqaro (ID: ${id}) topilmadi`);
    }

    return citizen;
  }

  async update(id: string, dto: UpdateCitizenDto): Promise<Citizen> {
    const citizen = await this.findOne(id);
    Object.assign(citizen, dto);
    return this.citizenRepo.save(citizen);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const citizen = await this.findOne(id);
    await this.citizenRepo.remove(citizen);
    return { success: true, message: "Fuqaro muvaffaqiyatli o'chirildi" };
  }
}
