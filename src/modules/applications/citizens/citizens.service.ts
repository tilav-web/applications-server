import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { In, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { formatUzbekName } from '../../../common/utils/name-formatter.util';
import { IntelligenceSyncService } from '../../intelligence/intelligence-sync.service';
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
    private readonly intelligenceSync: IntelligenceSyncService,
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
    const saved = await this.citizenRepo.save(citizen);
    await this.intelligenceSync.syncCitizenEntity(saved);
    return saved;
  }

  private buildCitizensFilterQuery(
    search?: string,
    filters?: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      middleName?: string;
      passport?: string;
      phoneNumber?: string;
      cardNumber?: string;
      pinfl?: string;
      gender?: string;
      birthDate?: string;
      districtId?: string;
    },
  ) {
    const qb = this.citizenRepo.createQueryBuilder('citizen').orderBy('citizen.created_at', 'DESC');

    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      qb.andWhere(
        "(CONCAT_WS(' ', citizen.last_name, citizen.first_name, citizen.middle_name) ILIKE :q OR citizen.passport ILIKE :q OR citizen.pinfl ILIKE :q OR citizen.phone_number ILIKE :q)",
        { q },
      );
    }

    if (filters?.fullName?.trim()) {
      qb.andWhere(
        "CONCAT_WS(' ', citizen.last_name, citizen.first_name, citizen.middle_name) ILIKE :fullName",
        { fullName: `%${filters.fullName.trim()}%` },
      );
    }
    if (filters?.firstName?.trim()) {
      qb.andWhere('citizen.first_name ILIKE :firstName', {
        firstName: `%${filters.firstName.trim()}%`,
      });
    }
    if (filters?.lastName?.trim()) {
      qb.andWhere('citizen.last_name ILIKE :lastName', {
        lastName: `%${filters.lastName.trim()}%`,
      });
    }
    if (filters?.middleName?.trim()) {
      qb.andWhere('citizen.middle_name ILIKE :middleName', {
        middleName: `%${filters.middleName.trim()}%`,
      });
    }
    if (filters?.passport?.trim()) {
      qb.andWhere('citizen.passport ILIKE :passport', {
        passport: `%${filters.passport.trim()}%`,
      });
    }
    if (filters?.pinfl?.trim()) {
      qb.andWhere('citizen.pinfl ILIKE :pinfl', {
        pinfl: `%${filters.pinfl.trim()}%`,
      });
    }
    if (filters?.phoneNumber?.trim()) {
      const cleanedPhone = filters.phoneNumber.replace(/\D/g, '') || filters.phoneNumber.trim();
      const phoneQ = `%${cleanedPhone}%`;
      qb.andWhere(
        `(
          citizen.phone_number ILIKE :phoneQ
          OR EXISTS (
            SELECT 1 FROM phones ph
            WHERE ph.citizen_id = citizen.id AND ph.phone_number ILIKE :phoneQ
          )
        )`,
        { phoneQ },
      );
    }
    if (filters?.cardNumber?.trim()) {
      const cleanedCard = filters.cardNumber.replace(/\D/g, '') || filters.cardNumber.trim();
      const cardQ = `%${cleanedCard}%`;
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM cards c
          WHERE c.citizen_id = citizen.id AND (c.card_number ILIKE :cardQ OR c.masked_number ILIKE :cardQ)
        )`,
        { cardQ },
      );
    }
    if (filters?.gender?.trim()) {
      qb.andWhere('citizen.gender = :gender', { gender: filters.gender.trim() });
    }
    if (filters?.birthDate?.trim()) {
      qb.andWhere('citizen.birth_date = :birthDate', { birthDate: filters.birthDate.trim() });
    }
    if (filters?.districtId?.trim()) {
      qb.andWhere('citizen.district_id = :districtId', { districtId: filters.districtId.trim() });
    }

    return qb;
  }

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    filters?: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      middleName?: string;
      passport?: string;
      phoneNumber?: string;
      cardNumber?: string;
      pinfl?: string;
      gender?: string;
      birthDate?: string;
      districtId?: string;
    },
  ): Promise<PaginatedResult<Citizen>> {
    const take = limit;
    const skip = (page - 1) * limit;

    const qb = this.buildCitizensFilterQuery(search, filters);
    const [matched, total] = await qb
      .select(['citizen.id', 'citizen.created_at'])
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const ids = matched.map((c) => c.id);
    let items: Citizen[] = [];
    if (ids.length > 0) {
      items = await this.citizenRepo.find({
        where: { id: In(ids) },
        relations: {
          cards: true,
          phones: true,
          digital_identifiers: true,
          applications: true,
          district: true,
          mahalla: true,
          occupation_category: true,
          occupation: true,
        },
      });
      items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    }

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
        phones: true,
        digital_identifiers: true,
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
    const saved = await this.citizenRepo.save(citizen);
    await this.intelligenceSync.syncCitizenEntity(saved);
    return saved;
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const citizen = await this.findOne(id);
    await this.citizenRepo.remove(citizen);
    return { success: true, message: "Fuqaro muvaffaqiyatli o'chirildi" };
  }

  async exportToExcel(
    search?: string,
    filters?: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      middleName?: string;
      passport?: string;
      phoneNumber?: string;
      cardNumber?: string;
      pinfl?: string;
      gender?: string;
      birthDate?: string;
      districtId?: string;
    },
    res?: Response,
  ): Promise<void> {
    const qb = this.buildCitizensFilterQuery(search, filters);
    const matched = await qb.select(['citizen.id', 'citizen.created_at']).take(10000).getMany();
    const ids = matched.map((c) => c.id);
    const items =
      ids.length > 0
        ? await this.citizenRepo.find({
            where: { id: In(ids) },
            relations: { cards: true, applications: true, district: true, mahalla: true },
            order: { created_at: 'DESC' },
          })
        : [];

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
