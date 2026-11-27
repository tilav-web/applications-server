import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { In, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import type { JwtAccessPayload } from '../../../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../../../common/utils/district-scope.util';
import { formatUzbekName } from '../../../../common/utils/name-formatter.util';
import {
  isPgUniqueViolation,
  normalizeCardNumber,
} from '../../../../common/utils/normalization.util';
import { IntelligenceSyncService } from '../../../intelligence/intelligence-sync.service';
import { User } from '../../../users/user.entity';
import { Card } from './card.entity';
import type { CreateCardDto } from './dto/create-card.dto';
import type { UpdateCardDto } from './dto/update-card.dto';
import { CardsExcelService } from './export/cards-excel.service';

@Injectable()
export class CardsService {
  constructor(
    @InjectRepository(Card)
    private readonly cardRepo: Repository<Card>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly excelService: CardsExcelService,
    @Optional()
    private readonly intelligenceSync?: IntelligenceSyncService,
  ) {}

  async create(dto: CreateCardDto): Promise<Card> {
    const cleanNum = normalizeCardNumber(dto.card_number) || '';
    const attachIfExisting = async (): Promise<Card | null> => {
      if (cleanNum.length < 8) return null;
      const existing = await this.cardRepo.findOne({
        where: { card_number: cleanNum },
        relations: { citizen: true, bank: true },
      });
      if (!existing) return null;
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
    };

    const existingBefore = await attachIfExisting();
    if (existingBefore) return existingBefore;

    const card = this.cardRepo.create({
      ...dto,
      full_name: dto.full_name ? formatUzbekName(dto.full_name) : null,
      card_number: cleanNum || null,
    });
    try {
      return await this.cardRepo.save(card);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        const raceExisting = await attachIfExisting();
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
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
      qb.andWhere('(card.full_name ILIKE :ownerQ OR citizen.full_name ILIKE :ownerQ)', { ownerQ });
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
          '(card.card_number ILIKE :q OR card.masked_number ILIKE :q OR card.full_name ILIKE :q OR card.card_number ILIKE :digitsQ OR citizen.full_name ILIKE :q)',
          { q, digitsQ: `%${digits}%` },
        );
      } else {
        qb.andWhere(
          '(card.card_number ILIKE :q OR card.masked_number ILIKE :q OR card.full_name ILIKE :q OR citizen.full_name ILIKE :q)',
          { q },
        );
      }
    }

    return qb;
  }

  private applyDistrictScope(
    qb: ReturnType<Repository<Card>['createQueryBuilder']>,
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
          WHERE a.card_id = card.id
            AND a.is_deleted = false
            AND a.district_id IN (:...allowedDistrictIds)
        )
        OR EXISTS (
          SELECT 1 FROM transfers t
          INNER JOIN applications a ON (a.id = t.application_id OR a.transfer_id = t.id)
          WHERE (t.sender_card_id = card.id OR t.receiver_card_id = card.id OR t.card_id = card.id)
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
    citizenId?: string,
    filters?: {
      bankId?: string;
      ownerState?: string;
      cardNumber?: string;
      ownerName?: string;
      phoneNumber?: string;
      expireDate?: string;
    },
    currentUser?: JwtAccessPayload,
  ): Promise<PaginatedResult<Card>> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const take = limit;
    const skip = (page - 1) * limit;

    const qb = this.buildCardsFilterQuery(search, citizenId, filters);
    this.applyDistrictScope(qb, allowedDistrictIds);
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

  async findOne(id: string, currentUser?: JwtAccessPayload): Promise<Card> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    if (allowedDistrictIds !== null) {
      const checkQb = this.cardRepo
        .createQueryBuilder('card')
        .leftJoin('card.citizen', 'citizen')
        .where('card.id = :id', { id });
      this.applyDistrictScope(checkQb, allowedDistrictIds);
      const accessible = await checkQb.select('card.id').getOne();
      if (!accessible) {
        throw new ForbiddenException(
          "Siz faqat o'zingizga biriktirilgan tuman(lar) kartalarini ko'rishingiz mumkin",
        );
      }
    }

    const card = await this.cardRepo.findOne({
      where: { id },
      relations: { citizen: true, bank: true, applications: true },
    });

    if (!card) {
      throw new NotFoundException(`Karta (ID: ${id}) topilmadi`);
    }

    if (allowedDistrictIds !== null) {
      card.applications = (card.applications || []).filter(
        (a) => !a.is_deleted && a.district_id && allowedDistrictIds.includes(a.district_id),
      );
    }

    return card;
  }

  async update(id: string, dto: UpdateCardDto, currentUser?: JwtAccessPayload): Promise<Card> {
    const card = await this.findOne(id, currentUser);
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
    if (dto.citizen_id !== undefined || dto.card_number !== undefined) {
      await this.intelligenceSync?.syncApplicationsByCardId(id);
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const card = await this.findOne(id);
    const cardLabel = card.card_number || card.masked_number || 'Plastik karta';
    await assertNoDependencies(this.cardRepo.manager, `«${cardLabel}» kartasi`, card.id, [
      {
        table: 'applications',
        column: 'card_id',
        label: 'ariza',
        extraWhere: 'is_deleted = false',
      },
      { table: 'transfers', column: 'sender_card_id', label: "yuboruvchi o'tkazma" },
      { table: 'transfers', column: 'receiver_card_id', label: "qabul qiluvchi o'tkazma" },
      { table: 'transfers', column: 'card_id', label: "bog'langan o'tkazma" },
      {
        table: 'application_custom_fields',
        column: 'card_id',
        label: "ariza qo'shimcha maydoni",
      },
      {
        table: 'transfer_custom_fields',
        column: 'card_id',
        label: "o'tkazma qo'shimcha maydoni",
      },
    ]);
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
    currentUser?: JwtAccessPayload,
  ): Promise<void> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const qb = this.buildCardsFilterQuery(search, citizenId, filters);
    this.applyDistrictScope(qb, allowedDistrictIds);
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

    const cardStatsMap = new Map<
      string,
      {
        incomingCount: number;
        incomingAmount: number;
        outgoingCount: number;
        outgoingAmount: number;
        appNumbers: Set<string>;
      }
    >();

    if (ids.length > 0) {
      for (const card of items) {
        const appNums = new Set<string>();
        for (const a of card.applications || []) {
          if (!a.is_deleted) {
            appNums.add(a.application_number || `AR-${a.id.slice(0, 8)}`);
          }
        }
        cardStatsMap.set(card.id, {
          incomingCount: 0,
          incomingAmount: 0,
          outgoingCount: 0,
          outgoingAmount: 0,
          appNumbers: appNums,
        });
      }

      const txRows: Array<{
        sender_card_id: string | null;
        receiver_card_id: string | null;
        amount: string | number | null;
        currency: string | null;
        app_id: string | null;
        app_num: string | null;
      }> = await this.cardRepo.manager.query(
        `SELECT t.sender_card_id, t.receiver_card_id, t.amount, t.currency,
                COALESCE(a1.id, a2.id) AS app_id,
                COALESCE(a1.application_number, a2.application_number) AS app_num
         FROM transfers t
         LEFT JOIN applications a1 ON a1.id = t.application_id AND a1.is_deleted = false
         LEFT JOIN applications a2 ON a2.transfer_id = t.id AND a2.is_deleted = false
         WHERE t.sender_card_id = ANY($1::uuid[]) OR t.receiver_card_id = ANY($1::uuid[])`,
        [ids],
      );

      for (const row of txRows) {
        const amt = Number(row.amount) || 0;
        const isUzs = !row.currency || row.currency.toUpperCase() === 'UZS';
        const appLabel = row.app_num || (row.app_id ? `AR-${row.app_id.slice(0, 8)}` : null);

        if (row.sender_card_id && cardStatsMap.has(row.sender_card_id)) {
          const st = cardStatsMap.get(row.sender_card_id)!;
          st.outgoingCount++;
          if (isUzs) st.outgoingAmount += amt;
          if (appLabel) st.appNumbers.add(appLabel);
        }
        if (row.receiver_card_id && cardStatsMap.has(row.receiver_card_id)) {
          const st = cardStatsMap.get(row.receiver_card_id)!;
          st.incomingCount++;
          if (isUzs) st.incomingAmount += amt;
          if (appLabel) st.appNumbers.add(appLabel);
        }
      }
    }

    const workbook = await this.excelService.generateWorkbook(items, cardStatsMap);
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

  async getStats(currentUser?: JwtAccessPayload): Promise<{
    total: number;
    attachedCount: number;
    unattachedCount: number;
    uzcardCount: number;
    humoCount: number;
    visaMasterCount: number;
    otherSystemCount: number;
    topBanks: Array<{ id: string; name: string; count: number; percent: number }>;
  }> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);

    const summaryQb = this.cardRepo
      .createQueryBuilder('card')
      .select('COUNT(card.id)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE card.citizen_id IS NOT NULL)', 'attachedCount')
      .addSelect('COUNT(*) FILTER (WHERE card.citizen_id IS NULL)', 'unattachedCount')
      .addSelect(
        `COUNT(*) FILTER (WHERE REGEXP_REPLACE(COALESCE(card.card_number, ''), '[^0-9]', '', 'g') LIKE '8600%' OR REGEXP_REPLACE(COALESCE(card.card_number, ''), '[^0-9]', '', 'g') LIKE '5614%')`,
        'uzcardCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE REGEXP_REPLACE(COALESCE(card.card_number, ''), '[^0-9]', '', 'g') LIKE '9860%')`,
        'humoCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE (REGEXP_REPLACE(COALESCE(card.card_number, ''), '[^0-9]', '', 'g') LIKE '4%' OR REGEXP_REPLACE(COALESCE(card.card_number, ''), '[^0-9]', '', 'g') LIKE '5%') AND REGEXP_REPLACE(COALESCE(card.card_number, ''), '[^0-9]', '', 'g') NOT LIKE '5614%')`,
        'visaMasterCount',
      );
    this.applyDistrictScope(summaryQb, allowedDistrictIds);

    const bankQb = this.cardRepo
      .createQueryBuilder('card')
      .innerJoin('card.bank', 'bank')
      .select('bank.id', 'id')
      .addSelect('bank.name', 'name')
      .addSelect('COUNT(card.id)', 'count')
      .groupBy('bank.id')
      .addGroupBy('bank.name')
      .orderBy('COUNT(card.id)', 'DESC')
      .limit(5);
    this.applyDistrictScope(bankQb, allowedDistrictIds);

    const [rawSummary, rawBanks] = await Promise.all([
      summaryQb.getRawOne<Record<string, string | null>>(),
      bankQb.getRawMany<{ id: string; name: string | null; count: string }>(),
    ]);

    const total = Number(rawSummary?.total) || 0;
    const uzcardCount = Number(rawSummary?.uzcardCount) || 0;
    const humoCount = Number(rawSummary?.humoCount) || 0;
    const visaMasterCount = Number(rawSummary?.visaMasterCount) || 0;
    const otherSystemCount = Math.max(0, total - uzcardCount - humoCount - visaMasterCount);

    const topBanks = rawBanks.map((row) => {
      const count = Number(row.count) || 0;
      return {
        id: row.id,
        name: row.name || 'Noma‘lum bank',
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });

    return {
      total,
      attachedCount: Number(rawSummary?.attachedCount) || 0,
      unattachedCount: Number(rawSummary?.unattachedCount) || 0,
      uzcardCount,
      humoCount,
      visaMasterCount,
      otherSystemCount,
      topBanks,
    };
  }
}
