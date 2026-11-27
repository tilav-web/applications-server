import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { In, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../../common/utils/district-scope.util';
import { formatUzbekName } from '../../../common/utils/name-formatter.util';
import {
  isPgUniqueViolation,
  normalizeCitizenFullName,
  normalizePassport,
  normalizePinfl,
  normalizeUzPhone,
} from '../../../common/utils/normalization.util';
import { IntelligenceSyncService } from '../../intelligence/intelligence-sync.service';
import { User } from '../../users/user.entity';
import { Citizen } from './citizen.entity';
import type { CreateCitizenDto } from './dto/create-citizen.dto';
import type { UpdateCitizenDto } from './dto/update-citizen.dto';
import { CitizensExcelService } from './export/citizens-excel.service';

@Injectable()
export class CitizensService {
  constructor(
    @InjectRepository(Citizen)
    private readonly citizenRepo: Repository<Citizen>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly excelService: CitizensExcelService,
    private readonly intelligenceSync: IntelligenceSyncService,
  ) {}

  async create(dto: CreateCitizenDto): Promise<Citizen> {
    const cleanPassport = normalizePassport(dto.passport);
    const cleanPinfl = normalizePinfl(dto.pinfl);
    const cleanPhone = normalizeUzPhone(dto.phone_number);
    const rawFullName = normalizeCitizenFullName(dto);
    const formattedFullName = rawFullName ? formatUzbekName(rawFullName) : null;

    const findExisting = async (): Promise<Citizen | null> => {
      if (cleanPassport) {
        const existing = await this.citizenRepo.findOne({ where: { passport: cleanPassport } });
        if (existing) return existing;
      }
      if (cleanPinfl) {
        const existing = await this.citizenRepo.findOne({ where: { pinfl: cleanPinfl } });
        if (existing) return existing;
      }
      if (cleanPhone && cleanPhone.length >= 7 && formattedFullName) {
        const existing = await this.citizenRepo.findOne({
          where: {
            phone_number: cleanPhone,
            full_name: formattedFullName,
          },
        });
        if (existing) return existing;
      }
      return null;
    };

    const existingBefore = await findExisting();
    if (existingBefore) return existingBefore;

    const {
      first_name: _firstName,
      last_name: _lastName,
      middle_name: _middleName,
      ...restDto
    } = dto;

    const citizen = this.citizenRepo.create({
      ...restDto,
      full_name: formattedFullName,
      passport: cleanPassport,
      pinfl: cleanPinfl,
      phone_number: cleanPhone,
    });
    let saved: Citizen;
    try {
      saved = await this.citizenRepo.save(citizen);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        const raceExisting = await findExisting();
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
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
        '(citizen.full_name ILIKE :q OR citizen.passport ILIKE :q OR citizen.pinfl ILIKE :q OR citizen.phone_number ILIKE :q)',
        { q },
      );
    }

    if (filters?.fullName?.trim()) {
      qb.andWhere('citizen.full_name ILIKE :fullName', {
        fullName: `%${filters.fullName.trim()}%`,
      });
    }
    if (filters?.firstName?.trim()) {
      qb.andWhere('citizen.full_name ILIKE :firstName', {
        firstName: `%${filters.firstName.trim()}%`,
      });
    }
    if (filters?.lastName?.trim()) {
      qb.andWhere('citizen.full_name ILIKE :lastName', {
        lastName: `%${filters.lastName.trim()}%`,
      });
    }
    if (filters?.middleName?.trim()) {
      qb.andWhere('citizen.full_name ILIKE :middleName', {
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

  private applyDistrictScope(
    qb: ReturnType<Repository<Citizen>['createQueryBuilder']>,
    allowedDistrictIds: string[] | null,
  ): void {
    if (allowedDistrictIds === null) return;
    if (allowedDistrictIds.length === 0) {
      qb.andWhere('1 = 0');
      return;
    }
    qb.andWhere(
      `(
        citizen.district_id IN (:...allowedDistrictIds)
        OR EXISTS (
          SELECT 1 FROM applications a
          WHERE a.citizen_id = citizen.id
            AND a.is_deleted = false
            AND a.district_id IN (:...allowedDistrictIds)
        )
      )`,
      { allowedDistrictIds },
    );
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
    currentUser?: JwtAccessPayload,
  ): Promise<PaginatedResult<Citizen>> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const take = limit;
    const skip = (page - 1) * limit;

    const qb = this.buildCitizensFilterQuery(search, filters);
    this.applyDistrictScope(qb, allowedDistrictIds);
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
          neighborhood: true,
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

  async findOne(id: string, currentUser?: JwtAccessPayload): Promise<Citizen> {
    const citizen = await this.citizenRepo.findOne({
      where: { id },
      relations: {
        cards: true,
        phones: true,
        digital_identifiers: true,
        applications: true,
        district: true,
        neighborhood: true,
        occupation_category: true,
        occupation: true,
        workplace: {
          district: true,
          neighborhood: true,
          occupation_category: true,
        },
      },
    });

    if (!citizen) {
      throw new NotFoundException(`Fuqaro (ID: ${id}) topilmadi`);
    }

    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    if (allowedDistrictIds !== null) {
      const inOwnDistrict =
        Boolean(citizen.district_id && allowedDistrictIds.includes(citizen.district_id)) ||
        (citizen.applications || []).some(
          (a) => !a.is_deleted && a.district_id && allowedDistrictIds.includes(a.district_id),
        );
      if (!inOwnDistrict) {
        throw new ForbiddenException(
          "Siz faqat o'zingizga biriktirilgan tuman(lar) fuqarolarini ko'rishingiz mumkin",
        );
      }
      citizen.applications = (citizen.applications || []).filter(
        (a) => !a.is_deleted && a.district_id && allowedDistrictIds.includes(a.district_id),
      );
    }

    return citizen;
  }

  async update(
    id: string,
    dto: UpdateCitizenDto,
    currentUser?: JwtAccessPayload,
  ): Promise<Citizen> {
    const citizen = await this.findOne(id, currentUser);
    const {
      first_name: legacyFirstName,
      last_name: legacyLastName,
      middle_name: legacyMiddleName,
      ...restDto
    } = dto;
    const updatedData: Partial<Citizen> = { ...restDto };
    if (
      dto.full_name !== undefined ||
      legacyFirstName !== undefined ||
      legacyLastName !== undefined ||
      legacyMiddleName !== undefined
    ) {
      const mergedName = normalizeCitizenFullName({
        full_name: dto.full_name,
        last_name: legacyLastName,
        first_name: legacyFirstName,
        middle_name: legacyMiddleName,
      });
      updatedData.full_name = mergedName ? formatUzbekName(mergedName) : null;
    }
    if (dto.passport !== undefined) {
      updatedData.passport = normalizePassport(dto.passport);
    }
    if (dto.pinfl !== undefined) {
      updatedData.pinfl = normalizePinfl(dto.pinfl);
    }
    if (dto.phone_number !== undefined) {
      updatedData.phone_number = normalizeUzPhone(dto.phone_number);
    }
    // Stale loaded relation ob'ektlarini tozalash (TypeORM FK yangilanishini bosib ketmasligi uchun)
    if (dto.district_id !== undefined)
      delete (citizen as unknown as Record<string, unknown>).district;
    if (dto.neighborhood_id !== undefined)
      delete (citizen as unknown as Record<string, unknown>).neighborhood;
    if (dto.occupation_category_id !== undefined)
      delete (citizen as unknown as Record<string, unknown>).occupation_category;
    if (dto.occupation_id !== undefined)
      delete (citizen as unknown as Record<string, unknown>).occupation;
    if (dto.workplace_id !== undefined)
      delete (citizen as unknown as Record<string, unknown>).workplace;
    delete (citizen as unknown as Record<string, unknown>).cards;
    delete (citizen as unknown as Record<string, unknown>).phones;
    delete (citizen as unknown as Record<string, unknown>).digital_identifiers;
    delete (citizen as unknown as Record<string, unknown>).applications;

    Object.assign(citizen, updatedData);
    const saved = await this.citizenRepo.save(citizen);
    await this.intelligenceSync.syncCitizenEntity(saved);
    if (dto.phone_number !== undefined) {
      await this.intelligenceSync.syncApplicationsByCitizenId(saved.id);
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const citizen = await this.findOne(id);
    const fullName = citizen.full_name?.trim() || 'Fuqaro';
    await assertNoDependencies(this.citizenRepo.manager, `«${fullName}»`, citizen.id, [
      {
        table: 'applications',
        column: 'citizen_id',
        label: 'ariza',
        extraWhere: 'is_deleted = false',
      },
      { table: 'cards', column: 'citizen_id', label: 'plastik karta' },
      { table: 'detected_crime_suspects', column: 'citizen_id', label: 'aniqlangan jinoyat' },
      {
        table: 'application_custom_fields',
        column: 'citizen_id',
        label: "ariza qo'shimcha maydoni",
      },
      {
        table: 'transfer_custom_fields',
        column: 'citizen_id',
        label: "o'tkazma qo'shimcha maydoni",
      },
    ]);
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
    currentUser?: JwtAccessPayload,
  ): Promise<void> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const qb = this.buildCitizensFilterQuery(search, filters);
    this.applyDistrictScope(qb, allowedDistrictIds);
    const matched = await qb.select(['citizen.id', 'citizen.created_at']).take(10000).getMany();
    const ids = matched.map((c) => c.id);
    const items =
      ids.length > 0
        ? await this.citizenRepo.find({
            where: { id: In(ids) },
            relations: {
              cards: { bank: true },
              applications: true,
              district: true,
              neighborhood: true,
              occupation_category: true,
              occupation: true,
              workplace: true,
              phones: true,
            },
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
