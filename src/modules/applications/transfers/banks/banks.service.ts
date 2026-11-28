import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { formatTitleCase } from '../../../../common/utils/name-formatter.util';
import {
  escapeLikePattern,
  isPgUniqueViolation,
} from '../../../../common/utils/normalization.util';
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
    const count = await this.bankRepo.count();
    if (count > 0) return;

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
    const cleanName = dto.name ? formatTitleCase(dto.name.trim()) : '';
    const cleanMfo = dto.mfo?.trim() || null;
    if (!cleanName) throw new BadRequestException('Bank nomi kiritilishi shart');

    const findExisting = () =>
      this.bankRepo.findOne({
        where: [
          { name: ILike(escapeLikePattern(cleanName)) },
          ...(cleanMfo ? [{ mfo: cleanMfo }] : []),
        ],
      });

    const existing = await findExisting();
    if (existing) return existing;

    const bank = this.bankRepo.create({
      ...dto,
      name: cleanName,
      mfo: cleanMfo,
    });
    try {
      return await this.bankRepo.save(bank);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        const raceExisting = await findExisting();
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<Bank>> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const take = safeLimit;
    const skip = (safePage - 1) * safeLimit;

    let where: FindOptionsWhere<Bank> | FindOptionsWhere<Bank>[] = {};
    if (search?.trim()) {
      const q = `%${escapeLikePattern(search.trim())}%`;
      where = [{ name: ILike(q) }, { code: ILike(q) }, { mfo: ILike(q) }];
    }

    const [items, total] = await this.bankRepo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip,
      take,
    });

    const totalPages = Math.ceil(total / safeLimit) || 1;

    return {
      items,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
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
    const bank = await this.bankRepo.findOne({ where: { id } });
    if (!bank) {
      throw new NotFoundException(`Bank (ID: ${id}) topilmadi`);
    }
    const updatedData: Partial<Bank> = { ...dto };
    if (dto.name !== undefined) {
      const nextName = dto.name ? formatTitleCase(dto.name.trim()) : '';
      if (!nextName) throw new BadRequestException("Bank nomi bo'sh bo'lishi mumkin emas");
      const existing = await this.bankRepo.findOne({
        where: { name: ILike(escapeLikePattern(nextName)) },
      });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`"${nextName}" nomli bank allaqachon mavjud`);
      }
      updatedData.name = nextName;
    }
    if (dto.mfo !== undefined) {
      const cleanMfo = dto.mfo?.trim() || null;
      if (cleanMfo) {
        const existingMfo = await this.bankRepo.findOne({ where: { mfo: cleanMfo } });
        if (existingMfo && existingMfo.id !== id) {
          throw new BadRequestException(`"${cleanMfo}" MFO kodli bank allaqachon mavjud`);
        }
      }
      updatedData.mfo = cleanMfo;
    }
    Object.assign(bank, updatedData);
    try {
      return await this.bankRepo.save(bank);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new ConflictException('Bunday nom yoki MFO kodli bank allaqachon mavjud');
      }
      throw err;
    }
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const bank = await this.bankRepo.findOne({ where: { id } });
    if (!bank) {
      throw new NotFoundException(`Bank (ID: ${id}) topilmadi`);
    }
    await assertNoDependencies(this.bankRepo.manager, `«${bank.name}» banki`, bank.id, [
      { table: 'cards', column: 'bank_id', label: 'plastik karta' },
      {
        table: 'transfer_custom_fields',
        column: 'bank_id',
        label: "o'tkazma qo'shimcha maydoni",
      },
    ]);
    await this.bankRepo.remove(bank);
    return { success: true, message: "Bank muvaffaqiyatli o'chirildi" };
  }
}
