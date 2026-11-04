import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { TransferCustomField } from './custom-fields/transfer-custom-field.entity';
import type { CreateTransferDto } from './dto/create-transfer.dto';
import type { UpdateTransferDto } from './dto/update-transfer.dto';
import { Transfer } from './transfer.entity';

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(TransferCustomField)
    private readonly customFieldRepo: Repository<TransferCustomField>,
  ) {}

  async create(dto: CreateTransferDto): Promise<Transfer> {
    const { custom_fields, ...transferData } = dto;
    const transfer = this.transferRepo.create(transferData);
    const saved = await this.transferRepo.save(transfer);

    if (custom_fields && custom_fields.length > 0) {
      const fieldEntities = custom_fields.map((f) =>
        this.customFieldRepo.create({
          ...f,
          transfer_id: saved.id,
        }),
      );
      await this.customFieldRepo.save(fieldEntities);
    }

    return this.findOne(saved.id);
  }

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    applicationId?: string,
  ): Promise<PaginatedResult<Transfer>> {
    const where: FindOptionsWhere<Transfer> = {};
    if (applicationId) {
      where.application_id = applicationId;
    }

    const take = limit;
    const skip = (page - 1) * limit;

    let whereCondition: FindOptionsWhere<Transfer> | FindOptionsWhere<Transfer>[] = where;

    if (search) {
      const q = `%${search}%`;
      whereCondition = [{ ...where, transaction_id: ILike(q) }];
    }

    const [items, total] = await this.transferRepo.findAndCount({
      where: whereCondition,
      relations: {
        payment_provider: true,
        sender_card: true,
        receiver_card: true,
        card: true,
        custom_fields: true,
      },
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

  async findOne(id: string): Promise<Transfer> {
    const transfer = await this.transferRepo.findOne({
      where: { id },
      relations: {
        payment_provider: true,
        sender_card: true,
        receiver_card: true,
        card: true,
        custom_fields: true,
        application: true,
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Pul o'tkazmasi (ID: ${id}) topilmadi`);
    }

    return transfer;
  }

  async update(id: string, dto: UpdateTransferDto): Promise<Transfer> {
    const transfer = await this.findOne(id);
    const { custom_fields, ...transferData } = dto;

    Object.assign(transfer, transferData);
    await this.transferRepo.save(transfer);

    if (custom_fields !== undefined) {
      // Mavjud maydonlarni yangilash yoki almashtirish
      await this.customFieldRepo.delete({ transfer_id: id });
      if (custom_fields.length > 0) {
        const fieldEntities = custom_fields.map((f) =>
          this.customFieldRepo.create({
            ...f,
            transfer_id: id,
          }),
        );
        await this.customFieldRepo.save(fieldEntities);
      }
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const transfer = await this.findOne(id);
    await this.transferRepo.remove(transfer);
    return {
      success: true,
      message: "Pul o'tkazmasi muvaffaqiyatli o'chirildi",
    };
  }
}
