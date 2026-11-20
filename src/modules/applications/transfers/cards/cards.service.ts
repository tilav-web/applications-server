import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { In, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { formatUzbekName } from '../../../../common/utils/name-formatter.util';
import { Card } from './card.entity';
import type { CreateCardDto } from './dto/create-card.dto';
import type { UpdateCardDto } from './dto/update-card.dto';
import { CardsExcelService } from './export/cards-excel.service';

@Injectable()
export class CardsService {
  constructor(
    @InjectRepository(Card)
    private readonly cardRepo: Repository<Card>,
    private readonly excelService: CardsExcelService,
  ) {}

  async create(dto: CreateCardDto): Promise<Card> {
    const cleanNum = dto.card_number ? dto.card_number.replace(/\D/g, '') : '';
    if (cleanNum.length >= 8) {
      const existing = await this.cardRepo.findOne({
        where: { card_number: cleanNum },
        relations: { citizen: true, bank: true },
      });
      if (existing) {
        let changed = false;
        if (dto.citizen_id && !existing.citizen_id) {
          existing.citizen_id = dto.citizen_id;
          changed = true;
        }
        if (dto.bank_id && !existing.bank_id) {
          existing.bank_id = dto.bank_id;
          changed = true;
        }
        if (dto.full_name && !existing.full_name) {
          existing.full_name = formatUzbekName(dto.full_name);
          changed = true;
        }
        if (dto.expire_date && !existing.expire_date) {
          existing.expire_date = dto.expire_date;
          changed = true;
        }
        return changed ? this.cardRepo.save(existing) : existing;
      }
    }

    const card = this.cardRepo.create({
      ...dto,
      full_name: dto.full_name ? formatUzbekName(dto.full_name) : null,
      card_number: cleanNum,
    });
    return this.cardRepo.save(card);
  }

  private buildCardsFilterQuery(
    search?: string,
    citizenId?: string,
    filters?: {
      bankId?: string;
      ownerState?: string;
      cardNumber?: string;
      ownerName?: string;
      phoneNumber?: string;
      expireDate?: string;
    },
  ) {
    const qb = this.cardRepo
      .createQueryBuilder('card')
      .leftJoin('card.citizen', 'citizen')
      .orderBy('card.created_at', 'DESC');

    if (citizenId?.trim()) {
      qb.andWhere('card.citizen_id = :citizenId', { citizenId: citizenId.trim() });
    }
    if (filters?.bankId?.trim()) {
      qb.andWhere('card.bank_id = :bankId', { bankId: filters.bankId.trim() });
    }
    if (filters?.ownerState === 'attached') {
      qb.andWhere('card.citizen_id IS NOT NULL');
    } else if (filters?.ownerState === 'unattached') {
      qb.andWhere('card.citizen_id IS NULL');
    }
    if (filters?.cardNumber?.trim()) {
      const cleaned = filters.cardNumber.replace(/\D/g, '') || filters.cardNumber.trim();
      const cardQ = `%${cleaned}%`;
      qb.andWhere('(card.card_number ILIKE :cardQ OR card.masked_number ILIKE :cardQ)', { cardQ });
    }
    if (filters?.ownerName?.trim()) {
      const ownerQ = `%${filters.ownerName.trim()}%`;
      qb.andWhere(
        "(card.full_name ILIKE :ownerQ OR CONCAT_WS(' ', citizen.last_name, citizen.first_name, citizen.middle_name) ILIKE :ownerQ)",
        { ownerQ },
      );
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
    if (filters?.expireDate?.trim()) {
      qb.andWhere('card.expire_date ILIKE :expQ', { expQ: `%${filters.expireDate.trim()}%` });
    }
    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      const digits = search.replace(/\D/g, '');
      if (digits.length >= 3) {
        qb.andWhere(
          "(card.card_number ILIKE :q OR card.masked_number ILIKE :q OR card.full_name ILIKE :q OR card.card_number ILIKE :digitsQ OR CONCAT_WS(' ', citizen.last_name, citizen.first_name, citizen.middle_name) ILIKE :q)",
          { q, digitsQ: `%${digits}%` },
        );
      } else {
        qb.andWhere(
          "(card.card_number ILIKE :q OR card.masked_number ILIKE :q OR card.full_name ILIKE :q OR CONCAT_WS(' ', citizen.last_name, citizen.first_name, citizen.middle_name) ILIKE :q)",
          { q },
        );
      }
    }

    return qb;
  }

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    citizenId?: string,
    filters?: {
      bankId?: string;
      ownerState?: string;
      cardNumber?: string;
      ownerName?: string;
      phoneNumber?: string;
      expireDate?: string;
    },
  ): Promise<PaginatedResult<Card>> {
    const take = limit;
    const skip = (page - 1) * limit;

    const qb = this.buildCardsFilterQuery(search, citizenId, filters);
    const [matched, total] = await qb
      .select(['card.id', 'card.created_at'])
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const ids = matched.map((c) => c.id);
    let items: Card[] = [];
    if (ids.length > 0) {
      items = await this.cardRepo.find({
        where: { id: In(ids) },
        relations: { citizen: true, bank: true },
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

  async findOne(id: string): Promise<Card> {
    const card = await this.cardRepo.findOne({
      where: { id },
      relations: { citizen: true, bank: true, applications: true },
    });

    if (!card) {
      throw new NotFoundException(`Karta (ID: ${id}) topilmadi`);
    }

    return card;
  }

  async update(id: string, dto: UpdateCardDto): Promise<Card> {
    const card = await this.findOne(id);
    const updatedData: Partial<Card> = { ...dto };
    if (dto.full_name !== undefined) {
      updatedData.full_name = dto.full_name ? formatUzbekName(dto.full_name) : null;
    }
    if (dto.card_number !== undefined) {
      updatedData.card_number = dto.card_number ? dto.card_number.replace(/\D/g, '') : '';
    }
    // Stale loaded relation ob'ektlarini tozalash (TypeORM FK yangilanishini bosib ketmasligi uchun)
    if (dto.bank_id !== undefined) delete (card as unknown as Record<string, unknown>).bank;
    if (dto.citizen_id !== undefined) delete (card as unknown as Record<string, unknown>).citizen;
    delete (card as unknown as Record<string, unknown>).applications;

    Object.assign(card, updatedData);
    await this.cardRepo.save(card);
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const card = await this.findOne(id);
    await this.cardRepo.remove(card);
    return { success: true, message: "Karta muvaffaqiyatli o'chirildi" };
  }

  async exportToExcel(
    search?: string,
    citizenId?: string,
    res?: Response,
    filters?: {
      bankId?: string;
      ownerState?: string;
      cardNumber?: string;
      ownerName?: string;
      phoneNumber?: string;
      expireDate?: string;
    },
  ): Promise<void> {
    const qb = this.buildCardsFilterQuery(search, citizenId, filters);
    const matched = await qb.select(['card.id', 'card.created_at']).take(10000).getMany();
    const ids = matched.map((c) => c.id);
    const items =
      ids.length > 0
        ? await this.cardRepo.find({
            where: { id: In(ids) },
            relations: { citizen: true, bank: true, applications: true },
            order: { created_at: 'DESC' },
          })
        : [];

    const workbook = await this.excelService.generateWorkbook(items);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Plastik_Kartalar_${dateStr}.xlsx`;

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
