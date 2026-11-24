import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { formatTitleCase } from '../../../../common/utils/name-formatter.util';
import { Bank } from './bank.entity';
import type { CreateBankDto } from './dto/create-bank.dto';
import type { UpdateBankDto } from './dto/update-bank.dto';

export const DEFAULT_UZBEKISTAN_BANKS: Array<{ name: string; code: string; mfo: string }> = [
  { name: 'Xalq Banki', code: 'XALQ_BANK', mfo: '01125' },
  { name: 'Agrobank', code: 'AGROBANK', mfo: '00394' },
  { name: 'Milliy Bank (NBU)', code: 'NBU', mfo: '00450' },
  { name: "O'zsanoatqurilishbank (SQB)", code: 'SQB', mfo: '00440' },
  { name: 'Ipoteka Bank', code: 'IPOTEKA', mfo: '00075' },
  { name: 'Asakabank', code: 'ASAKABANK', mfo: '00873' },
  { name: 'Mikrokreditbank', code: 'MKBANK', mfo: '00433' },
  { name: 'Biznesni Rivojlantirish Banki (BRB)', code: 'BRB', mfo: '01037' },
  { name: 'Aloqabank', code: 'ALOQABANK', mfo: '00401' },
  { name: 'Turonbank', code: 'TURONBANK', mfo: '00446' },
  { name: 'Kapitalbank', code: 'KAPITALBANK', mfo: '00974' },
  { name: 'Hamkorbank', code: 'HAMKORBANK', mfo: '00083' },
  { name: "Ipak Yo'li Banki", code: 'IPAK_YOLI', mfo: '00421' },
  { name: 'Trastbank', code: 'TRASTBANK', mfo: '00491' },
  { name: 'Orient Finans Bank (OFB)', code: 'OFB', mfo: '00981' },
  { name: 'InFinBank', code: 'INFINBANK', mfo: '00837' },
  { name: 'Davr Bank', code: 'DAVR_BANK', mfo: '00980' },
  { name: 'Universalbank', code: 'UNIVERSALBANK', mfo: '00973' },
  { name: 'Garant Bank', code: 'GARANT_BANK', mfo: '00902' },
  { name: 'Asia Alliance Bank', code: 'ASIA_ALLIANCE', mfo: '01041' },
  { name: 'Octobank', code: 'OCTOBANK', mfo: '01042' },
  { name: 'Ziraat Bank Uzbekistan', code: 'ZIRAAT', mfo: '01071' },
  { name: 'Poytaxt Bank', code: 'POYTAXT_BANK', mfo: '01132' },
  { name: 'Tenge Bank', code: 'TENGE_BANK', mfo: '01135' },
  { name: 'TBC Bank', code: 'TBC_BANK', mfo: '01180' },
  { name: 'Anorbank', code: 'ANORBANK', mfo: '01183' },
  { name: 'Uzum Bank', code: 'UZUM_BANK', mfo: '01197' },
  { name: 'Smart Bank', code: 'SMART_BANK', mfo: '01194' },
  { name: 'Hayot Bank', code: 'HAYOT_BANK', mfo: '01195' },
  { name: 'Apex Bank', code: 'APEX_BANK', mfo: '01196' },
  { name: 'AVO Bank', code: 'AVO_BANK', mfo: '01201' },
  { name: 'KDB Bank Uzbekistan', code: 'KDB_BANK', mfo: '01018' },
  { name: 'Madad Invest Bank', code: 'MADAD_INVEST', mfo: '00976' },
  { name: 'Saderat Bank', code: 'SADERAT_BANK', mfo: '00842' },
];

@Injectable()
export class BanksService implements OnModuleInit {
  constructor(
    @InjectRepository(Bank)
    private readonly bankRepo: Repository<Bank>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    for (const item of DEFAULT_UZBEKISTAN_BANKS) {
      const existing = await this.bankRepo.findOne({
        where: [{ name: ILike(item.name) }, { mfo: item.mfo }],
      });

      if (existing) {
        let changed = false;
        if (!existing.code) {
          existing.code = item.code;
          changed = true;
        }
        if (existing.is_active === null || existing.is_active === undefined) {
          existing.is_active = true;
          changed = true;
        }
        if (changed) {
          await this.bankRepo.save(existing);
        }
        continue;
      }

      await this.bankRepo.save(
        this.bankRepo.create({
          name: item.name,
          code: item.code,
          mfo: item.mfo,
          is_active: true,
        }),
      );
    }
  }

  async create(dto: CreateBankDto): Promise<Bank> {
    const bank = this.bankRepo.create({
      ...dto,
      name: dto.name ? formatTitleCase(dto.name) : '',
    });
    return this.bankRepo.save(bank);
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<Bank>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Bank> | FindOptionsWhere<Bank>[] = {};
    if (search) {
      const q = `%${search}%`;
      where = [{ name: ILike(q) }, { code: ILike(q) }, { mfo: ILike(q) }];
    }

    const [items, total] = await this.bankRepo.findAndCount({
      where,
      order: { name: 'ASC' },
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

  async findOne(id: string): Promise<Bank> {
    const bank = await this.bankRepo.findOne({
      where: { id },
      relations: { cards: true },
    });

    if (!bank) {
      throw new NotFoundException(`Bank (ID: ${id}) topilmadi`);
    }

    return bank;
  }

  async update(id: string, dto: UpdateBankDto): Promise<Bank> {
    const bank = await this.findOne(id);
    const updatedData: Partial<Bank> = { ...dto };
    if (dto.name !== undefined) {
      updatedData.name = dto.name ? formatTitleCase(dto.name) : '';
    }
    Object.assign(bank, updatedData);
    return this.bankRepo.save(bank);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const bank = await this.findOne(id);
    await assertNoDependencies(this.bankRepo.manager, `«${bank.name}» banki`, bank.id, [
      { table: 'cards', column: 'bank_id', label: 'plastik karta' },
    ]);
    await this.bankRepo.remove(bank);
    return { success: true, message: "Bank muvaffaqiyatli o'chirildi" };
  }
}
