import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

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
    const card = this.cardRepo.create({
      ...dto,
      full_name: dto.full_name ? formatUzbekName(dto.full_name) : null,
      card_number: dto.card_number ? dto.card_number.replace(/\D/g, '') : '',
    });
    return this.cardRepo.save(card);
  }

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    citizenId?: string,
  ): Promise<PaginatedResult<Card>> {
    const where: FindOptionsWhere<Card> = {};

    if (citizenId) {
      where.citizen_id = citizenId;
    }

    const take = limit;
    const skip = (page - 1) * limit;

    let whereCondition: FindOptionsWhere<Card> | FindOptionsWhere<Card>[] = where;

    if (search) {
      const q = `%${search}%`;
      whereCondition = [
        { ...where, card_number: ILike(q) },
        { ...where, masked_number: ILike(q) },
      ];
    }

    const [items, total] = await this.cardRepo.findAndCount({
      where: whereCondition,
      relations: { citizen: true, bank: true },
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
    Object.assign(card, updatedData);
    return this.cardRepo.save(card);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const card = await this.findOne(id);
    await this.cardRepo.remove(card);
    return { success: true, message: "Karta muvaffaqiyatli o'chirildi" };
  }

  async exportToExcel(search?: string, citizenId?: string, res?: Response): Promise<void> {
    const where: FindOptionsWhere<Card> = {};
    if (citizenId) {
      where.citizen_id = citizenId;
    }

    let whereCondition: FindOptionsWhere<Card> | FindOptionsWhere<Card>[] = where;
    if (search) {
      const q = `%${search}%`;
      whereCondition = [
        { ...where, card_number: ILike(q) },
        { ...where, masked_number: ILike(q) },
        { ...where, full_name: ILike(q) },
      ];
    }

    const items = await this.cardRepo.find({
      where: whereCondition,
      relations: { citizen: true, bank: true, applications: true },
      order: { created_at: 'DESC' },
      take: 10000,
    });

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
