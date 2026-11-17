import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { In, Repository } from 'typeorm';

import { TransferStatus } from '../../../common/enums/transfer-status.enum';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import { TransferCustomField } from './custom-fields/transfer-custom-field.entity';
import type { CreateTransferDto } from './dto/create-transfer.dto';
import type { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransfersExcelService } from './export/transfers-excel.service';
import { Transfer } from './transfer.entity';

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(TransferCustomField)
    private readonly customFieldRepo: Repository<TransferCustomField>,
    private readonly excelService: TransfersExcelService,
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

  private buildTransfersFilterQuery(
    search?: string,
    filters?: {
      applicationId?: string;
      status?: string;
      providerId?: string;
      transactionId?: string;
      senderCardNumber?: string;
      receiverCardNumber?: string;
      transferDate?: string;
    },
  ) {
    const qb = this.transferRepo
      .createQueryBuilder('transfer')
      .leftJoin('transfer.sender_card', 'sender_card')
      .leftJoin('transfer.receiver_card', 'receiver_card')
      .orderBy('transfer.created_at', 'DESC');

    if (filters?.applicationId?.trim()) {
      qb.andWhere('transfer.application_id = :appId', { appId: filters.applicationId.trim() });
    }
    if (filters?.status?.trim()) {
      qb.andWhere('transfer.status = :status', { status: filters.status.trim() as TransferStatus });
    }
    if (filters?.providerId?.trim()) {
      qb.andWhere('transfer.payment_provider_id = :providerId', {
        providerId: filters.providerId.trim(),
      });
    }
    if (filters?.transactionId?.trim()) {
      qb.andWhere('transfer.transaction_id ILIKE :txId', {
        txId: `%${filters.transactionId.trim()}%`,
      });
    }
    if (filters?.senderCardNumber?.trim()) {
      const sClean = filters.senderCardNumber.replace(/\D/g, '') || filters.senderCardNumber.trim();
      const sCardQ = `%${sClean}%`;
      qb.andWhere(
        '(sender_card.card_number ILIKE :sCardQ OR sender_card.masked_number ILIKE :sCardQ)',
        {
          sCardQ,
        },
      );
    }
    if (filters?.receiverCardNumber?.trim()) {
      const rClean =
        filters.receiverCardNumber.replace(/\D/g, '') || filters.receiverCardNumber.trim();
      const rCardQ = `%${rClean}%`;
      qb.andWhere(
        '(receiver_card.card_number ILIKE :rCardQ OR receiver_card.masked_number ILIKE :rCardQ)',
        { rCardQ },
      );
    }
    if (filters?.transferDate?.trim()) {
      qb.andWhere('transfer.transfer_date = :transferDate', {
        transferDate: filters.transferDate.trim(),
      });
    }
    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      const digits = search.replace(/\D/g, '');
      if (digits.length >= 3) {
        qb.andWhere(
          '(transfer.transaction_id ILIKE :q OR sender_card.card_number ILIKE :dQ OR receiver_card.card_number ILIKE :dQ)',
          { q, dQ: `%${digits}%` },
        );
      } else {
        qb.andWhere('transfer.transaction_id ILIKE :q', { q });
      }
    }

    return qb;
  }

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    filters?: {
      applicationId?: string;
      status?: string;
      providerId?: string;
      transactionId?: string;
      senderCardNumber?: string;
      receiverCardNumber?: string;
      transferDate?: string;
    },
  ): Promise<PaginatedResult<Transfer>> {
    const take = limit;
    const skip = (page - 1) * limit;

    const qb = this.buildTransfersFilterQuery(search, filters);
    const [matched, total] = await qb
      .select(['transfer.id', 'transfer.created_at'])
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const ids = matched.map((t) => t.id);
    let items: Transfer[] = [];
    if (ids.length > 0) {
      items = await this.transferRepo.find({
        where: { id: In(ids) },
        relations: {
          payment_provider: true,
          sender_card: true,
          receiver_card: true,
          card: true,
          custom_fields: true,
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

  async exportToExcel(
    search?: string,
    res?: Response,
    filters?: {
      applicationId?: string;
      status?: string;
      providerId?: string;
      transactionId?: string;
      senderCardNumber?: string;
      receiverCardNumber?: string;
      transferDate?: string;
    },
  ): Promise<void> {
    const qb = this.buildTransfersFilterQuery(search, filters);
    const matched = await qb.select(['transfer.id', 'transfer.created_at']).take(10000).getMany();
    const ids = matched.map((t) => t.id);
    const items =
      ids.length > 0
        ? await this.transferRepo.find({
            where: { id: In(ids) },
            relations: {
              payment_provider: true,
              sender_card: { bank: true, citizen: true },
              receiver_card: { bank: true, citizen: true },
              application: true,
            },
            order: { created_at: 'DESC' },
          })
        : [];

    const workbook = await this.excelService.generateWorkbook(items);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Toluv_Otkazmalari_${dateStr}.xlsx`;

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
