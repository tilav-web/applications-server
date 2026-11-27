import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import type { CreateSuspectFieldConfigDto } from './dto/create-suspect-field-config.dto';
import type { UpdateSuspectFieldConfigDto } from './dto/update-suspect-field-config.dto';
import { SuspectFieldConfig } from './suspect-field-config.entity';

export const DEFAULT_SUSPECT_FIELDS = [
  {
    key: 'telegram_username',
    label: 'Telegram Username',
    category: 'Telegram',
    icon: 'Send',
    description: 'Gumonlanuvchining Telegram foydalanuvchi nomi (@nik)',
    sample_value: '@tilav_web',
    sort_order: 1,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'telegram_id',
    label: 'Telegram ID',
    category: 'Telegram',
    icon: 'Send',
    description: 'Gumonlanuvchining Telegram raqamli IDsi',
    sample_value: '123456789',
    sort_order: 2,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'telegram_bot',
    label: 'Telegram Bot',
    category: 'Telegram',
    icon: 'Send',
    description: 'Firibgarlikda ishlatilgan Telegram bot (@...bot)',
    sample_value: '@invest_bot',
    sort_order: 3,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'telegram_channel',
    label: 'Telegram Kanal / Guruh',
    category: 'Telegram',
    icon: 'Send',
    description: 'Firibgarlikda ishlatilgan Telegram kanal yoki guruh havolasi',
    sample_value: 'https://t.me/kanal_nomi',
    sort_order: 4,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'telegram_bio',
    label: 'Telegram Bio / Izoh',
    category: 'Telegram',
    icon: 'Send',
    description: 'Gumonlanuvchining Telegram profil tavsifi (faqat izoh, bog‘liqlik bermaydi)',
    sample_value: 'Online savdo boti',
    sort_order: 5,
    is_active: true,
    is_linkable: false,
  },
  {
    key: 'phone_number',
    label: 'Telefon raqami',
    category: 'Aloqa',
    icon: 'Phone',
    description: 'Gumonlanuvchi ishlatgan telefon raqami',
    sample_value: '+998901234567',
    sort_order: 6,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'whatsapp_number',
    label: 'WhatsApp raqami',
    category: 'Aloqa',
    icon: 'Phone',
    description: 'Gumonlanuvchi ishlatgan WhatsApp telefon raqami',
    sample_value: '+998901234567',
    sort_order: 7,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'instagram_username',
    label: 'Instagram Username',
    category: 'Instagram',
    icon: 'Instagram',
    description: 'Gumonlanuvchining Instagram akkaunti',
    sample_value: '@invest_uz',
    sort_order: 8,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'tiktok_username',
    label: 'TikTok Username',
    category: 'Ijtimoiy tarmoq',
    icon: 'Hash',
    description: 'Gumonlanuvchining TikTok akkaunti',
    sample_value: '@user_tiktok',
    sort_order: 9,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'olx_account',
    label: 'OLX / Savdo akkaunti',
    category: 'Savdo platforma',
    icon: 'Globe',
    description: 'OLX, Uzum yoki boshqa eʼlon saytidagi firibgar profili',
    sample_value: 'olx.uz/list/user/...',
    sort_order: 10,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'card_number',
    label: 'Bank plastik karta',
    category: 'Moliya',
    icon: 'CreditCard',
    description: 'Gumonlanuvchiga aloqador plastik karta raqami',
    sample_value: '9860 1234 5678 9012',
    sort_order: 11,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'bank_account',
    label: 'Bank hisob raqami',
    category: 'Moliya',
    icon: 'CreditCard',
    description: '20 xonali bank hisob raqami',
    sample_value: '20208000...',
    sort_order: 12,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'crypto_wallet',
    label: 'Kripto-hamyon',
    category: 'Moliya',
    icon: 'Coins',
    description: 'USDT / Bitcoin / TON yoki boshqa kripto-hamyon manzili',
    sample_value: 'TRX7x...92kd',
    sort_order: 13,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'exchange_uid',
    label: 'Kripto-birja UID',
    category: 'Moliya',
    icon: 'Coins',
    description: 'Binance, Bybit, OKX birja hisob UID raqami',
    sample_value: 'Binance UID 48291034',
    sort_order: 14,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'website_domain',
    label: 'Phishing sayt / Havola',
    category: 'Tarmoq',
    icon: 'Globe',
    description: 'Soxta veb-sayt, phishing domen yoki zararli havola',
    sample_value: 'https://pay-uz-bonus.xyz',
    sort_order: 15,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'apk_file',
    label: 'Zararli APK / Ilova',
    category: 'Tarmoq',
    icon: 'Globe',
    description: 'Jabrlanuvchiga yuborilgan zararli APK fayl nomi yoki hash',
    sample_value: 'milliybank_bonus.apk',
    sort_order: 16,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'ip_address',
    label: 'IP Manzil',
    category: 'Tarmoq',
    icon: 'Globe',
    description: 'Gumonlanuvchi ulangan IP manzil',
    sample_value: '185.120.45.67',
    sort_order: 17,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'imei',
    label: 'IMEI Kod',
    category: 'Qurilma',
    icon: 'Hash',
    description: 'Gumonlanuvchi yoki oʻgʻirlangan telefon IMEI kodi',
    sample_value: '356938035643809',
    sort_order: 18,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'email',
    label: 'Email manzil',
    category: 'Aloqa',
    icon: 'Globe',
    description: 'Gumonlanuvchining elektron pochta manzili',
    sample_value: 'scam@mail.com',
    sort_order: 19,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'car_plate',
    label: 'Avtoraqam',
    category: 'Boshqa',
    icon: 'Hash',
    description: 'Gumonlanuvchiga aloqador transport vositasi davlat raqami',
    sample_value: '70A123BC',
    sort_order: 20,
    is_active: true,
    is_linkable: true,
  },
  {
    key: 'other_info',
    label: 'Boshqa maʼlumot (Izoh)',
    category: 'Boshqa',
    icon: 'Hash',
    description: 'Qo‘shimcha erkin izoh (bog‘liqlik hosil qilmaydi)',
    sample_value: 'Oq rangli avtomashina',
    sort_order: 99,
    is_active: true,
    is_linkable: false,
  },
];

@Injectable()
export class SuspectFieldConfigsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuspectFieldConfigsService.name);

  constructor(
    @InjectRepository(SuspectFieldConfig)
    private readonly repo: Repository<SuspectFieldConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const existing = await this.repo.find();
      const existingByKey = new Map(existing.map((e) => [e.key, e]));
      let added = 0;
      for (const item of DEFAULT_SUSPECT_FIELDS) {
        const found = existingByKey.get(item.key);
        if (!found) {
          await this.repo.save(this.repo.create(item));
          added++;
        } else if (
          (item.key === 'telegram_bio' || item.key === 'other_info') &&
          found.is_linkable
        ) {
          found.is_linkable = false;
          await this.repo.save(found);
        }
      }
      if (added > 0) {
        this.logger.log(`Standart ${added} ta gumonlanuvchi parametri bazaga qo‘shildi.`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`suspect_field_configs bootstrap xatosi: ${msg}`);
    }
  }

  async findAll(
    page = 1,
    limit = 50,
    search?: string,
  ): Promise<PaginatedResult<SuspectFieldConfig>> {
    const where: FindOptionsWhere<SuspectFieldConfig>[] = [];

    if (search && search.trim()) {
      const q = search.trim();
      where.push(
        { label: ILike(`%${q}%`) },
        { key: ILike(`%${q}%`) },
        { category: ILike(`%${q}%`) },
      );
    }

    const [items, total] = await this.repo.findAndCount({
      where: where.length > 0 ? where : undefined,
      order: { sort_order: 'ASC', created_at: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
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

  async findAllActive(): Promise<SuspectFieldConfig[]> {
    return this.repo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
  }

  async findOne(id: string): Promise<SuspectFieldConfig> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Parametr topilmadi: ${id}`);
    }
    return item;
  }

  async create(dto: CreateSuspectFieldConfigDto): Promise<SuspectFieldConfig> {
    const cleanKey = dto.key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    if (!cleanKey) {
      throw new BadRequestException('Parametr kaliti (key) yaroqsiz formatda');
    }

    const existing = await this.repo.findOne({ where: { key: cleanKey } });
    if (existing) {
      throw new BadRequestException(`"${cleanKey}" kalitli parametr allaqachon mavjud`);
    }

    const entity = this.repo.create({
      ...dto,
      key: cleanKey,
      label: dto.label.trim(),
      category: (dto.category || 'Umumiy').trim(),
      icon: dto.icon || 'Hash',
      sort_order: dto.sort_order ?? 0,
      is_active: dto.is_active ?? true,
      is_linkable: dto.is_linkable ?? true,
    });

    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateSuspectFieldConfigDto): Promise<SuspectFieldConfig> {
    const item = await this.findOne(id);

    if (dto.key) {
      const cleanKey = dto.key
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');

      if (cleanKey !== item.key) {
        const existing = await this.repo.findOne({ where: { key: cleanKey } });
        if (existing && existing.id !== id) {
          throw new BadRequestException(`"${cleanKey}" kalitli parametr allaqachon mavjud`);
        }
        item.key = cleanKey;
      }
    }

    if (dto.label !== undefined) item.label = dto.label.trim();
    if (dto.category !== undefined) item.category = dto.category ? dto.category.trim() : null;
    if (dto.icon !== undefined) item.icon = dto.icon;
    if (dto.description !== undefined) item.description = dto.description;
    if (dto.sample_value !== undefined) item.sample_value = dto.sample_value;
    if (dto.sort_order !== undefined) item.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) item.is_active = dto.is_active;
    if (dto.is_linkable !== undefined) item.is_linkable = dto.is_linkable;

    return this.repo.save(item);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { success: true, message: `Parametr muvaffaqiyatli o‘chirildi: "${item.label}"` };
  }
}
