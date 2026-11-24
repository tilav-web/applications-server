import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { isPgUniqueViolation } from '../../../../common/utils/normalization.util';
import type { CreatePaymentProviderDto } from './dto/create-payment-provider.dto';
import type { UpdatePaymentProviderDto } from './dto/update-payment-provider.dto';
import { PaymentProvider } from './payment_provider.entity';

export const DEFAULT_PAYMENT_PROVIDERS: Array<{ name: string; code: string }> = [
  { name: 'Click', code: 'click' },
  { name: 'Payme', code: 'payme' },
  { name: 'Uzum Bank', code: 'uzum_bank' },
  { name: 'Paynet', code: 'paynet' },
  { name: 'Anorbank', code: 'anorbank' },
  { name: 'TBC UZ', code: 'tbc_uz' },
  { name: 'Xazna', code: 'xazna' },
  { name: 'Beepul', code: 'beepul' },
  { name: 'Oson', code: 'oson' },
  { name: 'Alif Mobi', code: 'alif_mobi' },
  { name: 'Humans', code: 'humans' },
  { name: 'Plum', code: 'plum' },
  { name: 'Upay', code: 'upay' },
  { name: 'Multicard', code: 'multicard' },
  { name: 'PayWay', code: 'payway' },
  { name: 'Unired', code: 'unired' },
  { name: 'ATTO', code: 'atto' },
  { name: 'AVO', code: 'avo' },
  { name: 'Milliy (NBU)', code: 'milliy' },
  { name: 'Mavrid (Mikrokreditbank)', code: 'mavrid' },
  { name: 'Zoomrad (Aloqabank)', code: 'zoomrad' },
  { name: 'Agrobank Mobile', code: 'agrobank_mobile' },
  { name: 'SQB Mobile', code: 'sqb_mobile' },
  { name: 'Ipoteka Retail', code: 'ipoteka_retail' },
  { name: 'Hamkor Mobile', code: 'hamkor_mobile' },
  { name: "Ipak Yo'li Mobile", code: 'ipak_yoli_mobile' },
  { name: 'Kapitalbank Mobile', code: 'kapitalbank_mobile' },
  { name: 'Asakabank Mobile', code: 'asakabank_mobile' },
];

@Injectable()
export class PaymentProvidersService implements OnModuleInit {
  constructor(
    @InjectRepository(PaymentProvider)
    private readonly providerRepo: Repository<PaymentProvider>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    const count = await this.providerRepo.count();
    if (count > 0) return;

    for (const item of DEFAULT_PAYMENT_PROVIDERS) {
      const existing = await this.providerRepo.findOne({
        where: [{ code: item.code }, { name: ILike(item.name) }],
      });

      if (existing) {
        if (!existing.code) {
          existing.code = item.code;
          await this.providerRepo.save(existing);
        }
        continue;
      }

      await this.providerRepo.save(
        this.providerRepo.create({
          name: item.name,
          code: item.code,
        }),
      );
    }
  }

  async create(dto: CreatePaymentProviderDto): Promise<PaymentProvider> {
    const cleanName = dto.name?.trim() || '';
    const cleanCode = dto.code?.trim().toLowerCase() || null;
    if (!cleanName) throw new BadRequestException("To'lov provayderi nomi kiritilishi shart");

    const findExisting = () =>
      this.providerRepo.findOne({
        where: [{ name: ILike(cleanName) }, ...(cleanCode ? [{ code: cleanCode }] : [])],
      });

    const existing = await findExisting();
    if (existing) return existing;

    const provider = this.providerRepo.create({
      ...dto,
      name: cleanName,
      code: cleanCode || cleanName.toLowerCase().replace(/\s+/g, '_').slice(0, 50),
    });
    try {
      return await this.providerRepo.save(provider);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        const raceExisting = await findExisting();
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
  }

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<PaymentProvider>> {
    const take = limit;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<PaymentProvider> | FindOptionsWhere<PaymentProvider>[] = {};
    if (search) {
      const q = `%${search}%`;
      where = [{ name: ILike(q) }, { code: ILike(q) }];
    }

    const [items, total] = await this.providerRepo.findAndCount({
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

  async findOne(id: string): Promise<PaymentProvider> {
    const provider = await this.providerRepo.findOne({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`To'lov provayderi (ID: ${id}) topilmadi`);
    }

    return provider;
  }

  async update(id: string, dto: UpdatePaymentProviderDto): Promise<PaymentProvider> {
    const provider = await this.findOne(id);
    if (dto.name !== undefined) {
      const cleanName = dto.name.trim();
      if (!cleanName)
        throw new BadRequestException("To'lov provayderi nomi bo'sh bo'lishi mumkin emas");
      const existing = await this.providerRepo.findOne({ where: { name: ILike(cleanName) } });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`"${cleanName}" nomli provayder allaqachon mavjud`);
      }
      provider.name = cleanName;
    }
    if (dto.code !== undefined) {
      const cleanCode = dto.code.trim().toLowerCase();
      if (cleanCode) {
        const existingCode = await this.providerRepo.findOne({ where: { code: cleanCode } });
        if (existingCode && existingCode.id !== id) {
          throw new BadRequestException(`"${cleanCode}" kodli provayder allaqachon mavjud`);
        }
        provider.code = cleanCode;
      }
    }
    return this.providerRepo.save(provider);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const provider = await this.findOne(id);
    await assertNoDependencies(
      this.providerRepo.manager,
      `«${provider.name}» to'lov provayderi`,
      provider.id,
      [
        { table: 'transfers', column: 'payment_provider_id', label: "o'tkazma" },
        {
          table: 'transfer_custom_fields',
          column: 'payment_provider_id',
          label: "o'tkazma qo'shimcha maydoni",
        },
      ],
    );
    await this.providerRepo.remove(provider);
    return {
      success: true,
      message: "To'lov provayderi muvaffaqiyatli o'chirildi",
    };
  }
}
