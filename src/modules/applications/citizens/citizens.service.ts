import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { formatUzbekName } from '../../../common/utils/name-formatter.util';
import { Citizen } from './citizen.entity';
import type { CreateCitizenDto } from './dto/create-citizen.dto';
import type { UpdateCitizenDto } from './dto/update-citizen.dto';
import { CitizensExcelService } from './export/citizens-excel.service';

@Injectable()
export class CitizensService {
  constructor(
    @InjectRepository(Citizen)
    private readonly citizenRepo: Repository<Citizen>,
    private readonly excelService: CitizensExcelService,
  ) {}

  async create(dto: CreateCitizenDto): Promise<Citizen> {
    const cleanPassport = dto.passport ? dto.passport.trim().toUpperCase() : null;
    const cleanPinfl = dto.pinfl ? dto.pinfl.trim() : null;
    const cleanPhone = dto.phone_number ? dto.phone_number.replace(/\D/g, '') : null;

    if (cleanPassport) {
      const existing = await this.citizenRepo.findOne({ where: { passport: cleanPassport } });
      if (existing) return existing;
    }
    if (cleanPinfl) {
      const existing = await this.citizenRepo.findOne({ where: { pinfl: cleanPinfl } });
      if (existing) return existing;
    }
    if (cleanPhone && cleanPhone.length >= 7 && dto.first_name && dto.last_name) {
      const existing = await this.citizenRepo.findOne({
        where: {
          phone_number: cleanPhone,
          first_name: formatUzbekName(dto.first_name),
          last_name: formatUzbekName(dto.last_name),
        },
      });
      if (existing) return existing;
    }

    const citizen = this.citizenRepo.create({
      ...dto,
      first_name: dto.first_name ? formatUzbekName(dto.first_name) : null,
      last_name: dto.last_name ? formatUzbekName(dto.last_name) : null,
      middle_name: dto.middle_name ? formatUzbekName(dto.middle_name) : null,
      passport: cleanPassport,
      pinfl: cleanPinfl,
      phone_number: cleanPhone,
    });
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
      gender?: string;
      birthDate?: string;
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
    if (filters?.gender?.trim()) {
      conditions.gender = filters.gender.trim() as 'male' | 'female';
    }
    if (filters?.birthDate?.trim()) {
      conditions.birth_date = filters.birthDate.trim();
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
      relations: {
        cards: true,
        district: true,
        mahalla: true,
        occupation_category: true,
        occupation: true,
      },
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
      relations: {
        cards: true,
        applications: true,
        district: true,
        mahalla: true,
        occupation_category: true,
        occupation: true,
      },
    });

    if (!citizen) {
      throw new NotFoundException(`Fuqaro (ID: ${id}) topilmadi`);
    }

    return citizen;
  }

  async update(id: string, dto: UpdateCitizenDto): Promise<Citizen> {
    const citizen = await this.findOne(id);
    const updatedData: Partial<Citizen> = { ...dto };
    if (dto.first_name !== undefined) {
      updatedData.first_name = dto.first_name ? formatUzbekName(dto.first_name) : null;
    }
    if (dto.last_name !== undefined) {
      updatedData.last_name = dto.last_name ? formatUzbekName(dto.last_name) : null;
    }
    if (dto.middle_name !== undefined) {
      updatedData.middle_name = dto.middle_name ? formatUzbekName(dto.middle_name) : null;
    }
    if (dto.passport !== undefined) {
      updatedData.passport = dto.passport ? dto.passport.trim().toUpperCase() : null;
    }
    if (dto.pinfl !== undefined) {
      updatedData.pinfl = dto.pinfl ? dto.pinfl.trim() : null;
    }
    if (dto.phone_number !== undefined) {
      updatedData.phone_number = dto.phone_number ? dto.phone_number.replace(/\D/g, '') : null;
    }
    Object.assign(citizen, updatedData);
    return this.citizenRepo.save(citizen);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const citizen = await this.findOne(id);
    await this.citizenRepo.remove(citizen);
    return { success: true, message: "Fuqaro muvaffaqiyatli o'chirildi" };
  }

  async exportToExcel(
    search?: string,
    filters?: {
      firstName?: string;
      lastName?: string;
      middleName?: string;
      passport?: string;
      phoneNumber?: string;
      pinfl?: string;
      gender?: string;
      birthDate?: string;
    },
    res?: Response,
  ): Promise<void> {
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
    if (filters?.gender?.trim()) {
      conditions.gender = filters.gender.trim() as 'male' | 'female';
    }
    if (filters?.birthDate?.trim()) {
      conditions.birth_date = filters.birthDate.trim();
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

    const items = await this.citizenRepo.find({
      where,
      relations: { cards: true, applications: true, district: true, mahalla: true },
      order: { created_at: 'DESC' },
      take: 10000,
    });

    const workbook = await this.excelService.generateWorkbook(items);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Fuqarolar_Bazasi_${dateStr}.xlsx`;

    if (res) {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      await workbook.xlsx.write(res);
      res.end();
    }
  }
}
