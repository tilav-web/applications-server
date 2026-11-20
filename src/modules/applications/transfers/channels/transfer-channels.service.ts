import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { TransferDestinationType } from '../../../../common/enums/transfer-destination-type.enum';
import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import type { CreateTransferChannelDto } from './dto/create-transfer-channel.dto';
import { TransferChannel } from './transfer-channel.entity';

const DEFAULT_CHANNELS: Array<Partial<TransferChannel>> = [
  {
    name: 'Plastik karta',
    code: 'CARD',
    category: TransferDestinationType.CARD,
    color: '#e74c3c',
    icon: '💳',
    presets: [],
    platform_label: null,
    platform_placeholder: null,
    value_label: 'Qabul qiluvchi (Tranzit / Dropper) karta raqami *',
    value_placeholder: '9860 1234 5678 9012',
    sort_order: 1,
    is_active: true,
  },
  {
    name: 'Kripto / Birja',
    code: 'CRYPTO',
    category: TransferDestinationType.CRYPTO,
    color: '#8b5cf6',
    icon: '🪙',
    presets: ['Binance', 'Bybit', 'OKX', 'USDT TRC-20', 'TON'],
    platform_label: 'Birja / Tarmoq nomi',
    platform_placeholder: 'Binance, Bybit, OKX, TRC-20...',
    value_label: 'Birja UID yoki Kripto-hamyon manzili *',
    value_placeholder: 'Masalan: UID 48291034 yoki TX9aK... (TRC-20)',
    sort_order: 2,
    is_active: true,
  },
  {
    name: 'Naqd / ATM',
    code: 'CASH',
    category: TransferDestinationType.CASH,
    color: '#059669',
    icon: '🏧',
    presets: ['Bankomat (ATM)', 'Bank kassasi', 'Valyuta ayirboshlash'],
    platform_label: 'Naqdlashtirish joyi turi',
    platform_placeholder: 'Bankomat / Bank filiali nomi',
    value_label: 'ATM ID yoki naqdlashtirilgan manzil *',
    value_placeholder: 'Masalan: ATM #402, Qarshi sh. Mustaqillik ko‘chasi',
    sort_order: 3,
    is_active: true,
  },
  {
    name: 'Onlayn Servis',
    code: 'PLATFORM',
    category: TransferDestinationType.PLATFORM,
    color: '#0891b2',
    icon: '🌐',
    presets: ['TikTok', 'Telegram', '1xBet', 'Steam', 'Visa Merchant'],
    platform_label: 'Platforma / Servis nomi',
    platform_placeholder: 'TikTok, Telegram, 1xBet, Visa Merchant...',
    value_label: 'Profil / Akkaunt ID yoki username *',
    value_placeholder: 'Masalan: @user_profile yoki ID 9912045',
    sort_order: 4,
    is_active: true,
  },
  {
    name: 'Hisob raqam',
    code: 'BANK_ACCOUNT',
    category: TransferDestinationType.BANK_ACCOUNT,
    color: '#475569',
    icon: '🏦',
    presets: ['Kapitalbank', 'Ipak Yo‘li', 'Hamkorbank', 'NBU'],
    platform_label: 'Bank nomi / MFO',
    platform_placeholder: 'Bank nomi yoki MFO kodi',
    value_label: '20 talik bank hisob raqami *',
    value_placeholder: '20208000...',
    sort_order: 5,
    is_active: true,
  },
];

@Injectable()
export class TransferChannelsService implements OnModuleInit {
  constructor(
    @InjectRepository(TransferChannel)
    private readonly channelRepo: Repository<TransferChannel>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const count = await this.channelRepo.count();
      if (count === 0) {
        for (const item of DEFAULT_CHANNELS) {
          const exists = await this.channelRepo.findOne({ where: { code: item.code! } });
          if (!exists) {
            await this.channelRepo.save(this.channelRepo.create(item));
          }
        }
      }
    } catch {
      // Table may not exist yet before migration runs
    }
  }

  private normalizeCode(raw: string): string {
    return raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  async findAll(page = 1, limit = 100, search?: string): Promise<PaginatedResult<TransferChannel>> {
    const take = limit;
    const skip = (page - 1) * limit;

    const where = search?.trim()
      ? [{ name: ILike(`%${search.trim()}%`) }, { code: ILike(`%${search.trim()}%`) }]
      : undefined;

    const [items, total] = await this.channelRepo.findAndCount({
      where,
      order: { sort_order: 'ASC', created_at: 'ASC' },
      take,
      skip,
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

  async findOne(id: string): Promise<TransferChannel> {
    const channel = await this.channelRepo.findOne({ where: { id } });
    if (!channel) {
      throw new NotFoundException(`Chiqish kanali (ID: ${id}) topilmadi`);
    }
    return channel;
  }

  async create(dto: CreateTransferChannelDto): Promise<TransferChannel> {
    const code = this.normalizeCode(dto.code || dto.name);
    if (!code) {
      throw new BadRequestException('Kanal kodi noto‘g‘ri');
    }

    const existing = await this.channelRepo.findOne({ where: { code } });
    if (existing) {
      throw new BadRequestException(`"${code}" kodli chiqish kanali allaqachon mavjud`);
    }

    const entity = this.channelRepo.create({
      ...dto,
      name: dto.name.trim(),
      code,
      category: dto.category || TransferDestinationType.PLATFORM,
      color: dto.color?.trim() || '#0891b2',
      icon: dto.icon?.trim() || '🌐',
      presets: (dto.presets || []).map((p) => p.trim()).filter(Boolean),
    });

    return this.channelRepo.save(entity);
  }

  async update(id: string, dto: Partial<CreateTransferChannelDto>): Promise<TransferChannel> {
    const channel = await this.findOne(id);

    if (dto.code !== undefined) {
      const nextCode = this.normalizeCode(dto.code);
      if (nextCode && nextCode !== channel.code) {
        const dup = await this.channelRepo.findOne({ where: { code: nextCode } });
        if (dup) {
          throw new BadRequestException(`"${nextCode}" kodli chiqish kanali allaqachon mavjud`);
        }
        channel.code = nextCode;
      }
    }

    if (dto.name !== undefined) channel.name = dto.name.trim();
    if (dto.category !== undefined) channel.category = dto.category;
    if (dto.color !== undefined) channel.color = dto.color.trim() || channel.color;
    if (dto.icon !== undefined) channel.icon = dto.icon.trim() || channel.icon;
    if (dto.presets !== undefined) {
      channel.presets = dto.presets.map((p) => p.trim()).filter(Boolean);
    }
    if (dto.platform_label !== undefined) channel.platform_label = dto.platform_label || null;
    if (dto.platform_placeholder !== undefined) {
      channel.platform_placeholder = dto.platform_placeholder || null;
    }
    if (dto.value_label !== undefined) channel.value_label = dto.value_label || null;
    if (dto.value_placeholder !== undefined) {
      channel.value_placeholder = dto.value_placeholder || null;
    }
    if (dto.sort_order !== undefined) channel.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) channel.is_active = dto.is_active;

    return this.channelRepo.save(channel);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const channel = await this.findOne(id);
    if (channel.code === 'CARD') {
      throw new BadRequestException('Asosiy "Plastik karta" kanalini o‘chirib bo‘lmaydi');
    }
    await this.channelRepo.remove(channel);
    return { success: true, message: 'Chiqish kanali o‘chirildi' };
  }
}
