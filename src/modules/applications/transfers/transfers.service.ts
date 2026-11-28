import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { In, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../common/database/dependency-guard.util';
import { TransferDestinationType } from '../../../common/enums/transfer-destination-type.enum';
import { TransferStatus } from '../../../common/enums/transfer-status.enum';
import type { PaginatedResult } from '../../../common/interfaces/pagination.interface';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../../common/utils/district-scope.util';
import { escapeLikePattern, isPgUniqueViolation } from '../../../common/utils/normalization.util';
import { DigitalIdentifierEntity } from '../../intelligence/entities/digital-identifier.entity';
import { IntelligenceSyncService } from '../../intelligence/intelligence-sync.service';
import {
  getIdentifierTypeLabel,
  normalizeIdentifierValue,
} from '../../intelligence/utils/identifier-normalizer.util';
import { User } from '../../users/user.entity';
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
    @InjectRepository(DigitalIdentifierEntity)
    private readonly identifierRepo: Repository<DigitalIdentifierEntity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly excelService: TransfersExcelService,
    @Optional()
    private readonly intelligenceSync?: IntelligenceSyncService,
  ) {}

  private async resolveDestinationFields(dto: {
    destination_type?: TransferDestinationType;
    receiver_identifier_id?: string;
    destination_platform?: string;
    destination_value?: string;
    destination_label?: string;
    destination_details?: Record<string, unknown>;
  }): Promise<{
    destination_type: TransferDestinationType;
    receiver_identifier_id: string | null;
    destination_label: string | null;
    destination_details: Record<string, unknown> | null;
  }> {
    const destType = dto.destination_type || TransferDestinationType.CARD;
    const platform = dto.destination_platform?.trim() || '';
    const rawVal = dto.destination_value?.trim() || '';
    const details: Record<string, unknown> = {
      ...(dto.destination_details || {}),
      ...(platform ? { platform } : {}),
      ...(rawVal ? { value: rawVal } : {}),
    };

    let receiverIdentifierId = dto.receiver_identifier_id || null;
    let label = dto.destination_label?.trim() || null;

    if (destType !== TransferDestinationType.CARD) {
      if (!label) {
        if (platform && rawVal) label = `${platform}: ${rawVal}`;
        else if (rawVal) label = rawVal;
        else if (platform) label = platform;
      }

      // CRYPTO, PLATFORM, BANK_ACCOUNT, OTHER uchun yagona master digital_identifiers jadvaliga bog'lash
      if (
        !receiverIdentifierId &&
        rawVal.length >= 2 &&
        destType !== TransferDestinationType.CASH
      ) {
        const identType =
          destType === TransferDestinationType.CRYPTO
            ? 'crypto_wallet'
            : destType === TransferDestinationType.BANK_ACCOUNT
              ? 'bank_account'
              : destType === TransferDestinationType.PLATFORM
                ? platform
                  ? `platform_${platform.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
                  : 'online_platform'
                : 'cashout_destination';

        const normalized = normalizeIdentifierValue(identType, rawVal);
        if (normalized && normalized.length >= 2) {
          let ident = await this.identifierRepo.findOne({
            where: { type: identType, normalized_value: normalized },
          });
          if (!ident) {
            try {
              ident = await this.identifierRepo.save(
                this.identifierRepo.create({
                  type: identType,
                  type_label:
                    platform ||
                    getIdentifierTypeLabel(
                      identType,
                      destType === TransferDestinationType.CRYPTO
                        ? 'Kripto-hamyon / Birja'
                        : destType === TransferDestinationType.BANK_ACCOUNT
                          ? 'Bank hisob raqami'
                          : 'Onlayn tizim / Profil',
                    ),
                  raw_value: rawVal,
                  normalized_value: normalized,
                }),
              );
            } catch (err) {
              if (isPgUniqueViolation(err)) {
                ident = await this.identifierRepo.findOne({
                  where: { type: identType, normalized_value: normalized },
                });
                if (!ident) throw err;
              } else {
                throw err;
              }
            }
          }
          receiverIdentifierId = ident.id;
        }
      }
    }

    return {
      destination_type: destType,
      receiver_identifier_id: receiverIdentifierId,
      destination_label: label,
      destination_details: Object.keys(details).length > 0 ? details : null,
    };
  }

  async create(dto: CreateTransferDto): Promise<Transfer> {
    const {
      custom_fields,
      destination_platform,
      destination_value,
      destination_type,
      receiver_identifier_id,
      destination_label,
      destination_details,
      ...transferData
    } = dto;

    const resolvedDest = await this.resolveDestinationFields({
      destination_type,
      receiver_identifier_id,
      destination_platform,
      destination_value,
      destination_label,
      destination_details,
    });

    const transfer = this.transferRepo.create({
      ...transferData,
      ...resolvedDest,
      receiver_card_id:
        resolvedDest.destination_type === TransferDestinationType.CARD
          ? transferData.receiver_card_id || null
          : null,
    });
    let saved: Transfer;
    try {
      saved = await this.transferRepo.save(transfer);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new ConflictException(
          "Ushbu tranzaksiya ID (transaction_id) bilan o'tkazma allaqachon mavjud",
        );
      }
      throw err;
    }

    if (custom_fields && custom_fields.length > 0) {
      const fieldEntities = custom_fields.map((f) =>
        this.customFieldRepo.create({
          ...f,
          transfer_id: saved.id,
        }),
      );
      await this.customFieldRepo.save(fieldEntities);
    }

    if (saved.application_id) {
      await this.intelligenceSync?.syncApplicationById(saved.application_id);
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
        txId: `%${escapeLikePattern(filters.transactionId.trim())}%`,
      });
    }
    if (filters?.senderCardNumber?.trim()) {
      const sClean = filters.senderCardNumber.replace(/\D/g, '') || filters.senderCardNumber.trim();
      const sCardQ = `%${escapeLikePattern(sClean)}%`;
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
      const rCardQ = `%${escapeLikePattern(rClean)}%`;
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
      const q = `%${escapeLikePattern(search.trim())}%`;
      const digits = search.replace(/\D/g, '');
      if (digits.length >= 3) {
        qb.andWhere(
          '(transfer.transaction_id ILIKE :q OR sender_card.card_number ILIKE :dQ OR receiver_card.card_number ILIKE :dQ)',
          { q, dQ: `%${escapeLikePattern(digits)}%` },
        );
      } else {
        qb.andWhere('transfer.transaction_id ILIKE :q', { q });
      }
    }

    return qb;
  }

  private applyDistrictScope(
    qb: ReturnType<Repository<Transfer>['createQueryBuilder']>,
    allowedDistrictIds: string[] | null,
  ): void {
    if (allowedDistrictIds === null) return;
    if (allowedDistrictIds.length === 0) {
      qb.andWhere('1 = 0');
      return;
    }
    qb.andWhere(
      `EXISTS (
        SELECT 1 FROM applications a
        WHERE (a.id = transfer.application_id OR a.transfer_id = transfer.id)
          AND a.is_deleted = false
          AND a.district_id IN (:...allowedDistrictIds)
      )`,
      { allowedDistrictIds },
    );
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
    currentUser?: JwtAccessPayload,
  ): Promise<PaginatedResult<Transfer>> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const take = safeLimit;
    const skip = (safePage - 1) * safeLimit;

    const qb = this.buildTransfersFilterQuery(search, filters);
    this.applyDistrictScope(qb, allowedDistrictIds);
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
          receiver_identifier: true,
          card: true,
          custom_fields: true,
        },
      });
      const orderMap = new Map(ids.map((id, idx) => [id, idx]));
      items.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }

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

  async findOne(id: string, currentUser?: JwtAccessPayload): Promise<Transfer> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    if (allowedDistrictIds !== null) {
      const checkQb = this.transferRepo
        .createQueryBuilder('transfer')
        .where('transfer.id = :id', { id });
      this.applyDistrictScope(checkQb, allowedDistrictIds);
      const accessible = await checkQb.select('transfer.id').getOne();
      if (!accessible) {
        throw new ForbiddenException(
          "Siz faqat o'zingizga biriktirilgan tuman(lar) o'tkazmalarini ko'rishingiz mumkin",
        );
      }
    }

    const transfer = await this.transferRepo.findOne({
      where: { id },
      relations: {
        payment_provider: true,
        sender_card: true,
        receiver_card: true,
        receiver_identifier: true,
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

  async update(
    id: string,
    dto: UpdateTransferDto,
    currentUser?: JwtAccessPayload,
  ): Promise<Transfer> {
    const transfer = await this.findOne(id, currentUser);
    const previousAppId = transfer.application_id;
    const {
      custom_fields,
      destination_platform,
      destination_value,
      destination_type,
      receiver_identifier_id,
      destination_label,
      destination_details,
      ...transferData
    } = dto;

    if (
      destination_type !== undefined ||
      destination_platform !== undefined ||
      destination_value !== undefined ||
      destination_label !== undefined ||
      destination_details !== undefined ||
      receiver_identifier_id !== undefined
    ) {
      const nextDestType = destination_type ?? transfer.destination_type;
      const resolvedDest = await this.resolveDestinationFields({
        destination_type: nextDestType,
        receiver_identifier_id:
          nextDestType === TransferDestinationType.CARD
            ? undefined
            : destination_value !== undefined
              ? undefined
              : (receiver_identifier_id ?? transfer.receiver_identifier_id ?? undefined),
        destination_platform,
        destination_value,
        destination_label:
          destination_label !== undefined
            ? destination_label
            : destination_platform === undefined && destination_value === undefined
              ? (transfer.destination_label ?? undefined)
              : undefined,
        destination_details:
          destination_details !== undefined
            ? destination_details
            : nextDestType === transfer.destination_type
              ? (transfer.destination_details ?? undefined)
              : undefined,
      });
      Object.assign(transfer, transferData, resolvedDest);
      if (resolvedDest.destination_type !== TransferDestinationType.CARD) {
        transfer.receiver_card_id = null;
      } else {
        transfer.receiver_identifier_id = null;
      }
    } else {
      Object.assign(transfer, transferData);
    }

    // Stale loaded relation ob'ektlarini tozalash (TypeORM FK yangilanishini bosib ketmasligi uchun)
    delete (transfer as unknown as Record<string, unknown>).payment_provider;
    delete (transfer as unknown as Record<string, unknown>).sender_card;
    delete (transfer as unknown as Record<string, unknown>).receiver_card;
    delete (transfer as unknown as Record<string, unknown>).receiver_identifier;
    delete (transfer as unknown as Record<string, unknown>).card;
    delete (transfer as unknown as Record<string, unknown>).application;
    delete (transfer as unknown as Record<string, unknown>).custom_fields;

    try {
      await this.transferRepo.manager.transaction(async (manager) => {
        const txTransferRepo = manager.getRepository(Transfer);
        const txFieldRepo = manager.getRepository(TransferCustomField);

        await txTransferRepo.save(transfer);

        if (custom_fields !== undefined) {
          // Mavjud maydonlarni tranzaksiya ichida yangilash yoki almashtirish
          await txFieldRepo.delete({ transfer_id: id });
          if (custom_fields.length > 0) {
            const fieldEntities = custom_fields.map((f) =>
              txFieldRepo.create({
                ...f,
                transfer_id: id,
              }),
            );
            await txFieldRepo.save(fieldEntities);
          }
        }
      });
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new ConflictException(
          "Ushbu tranzaksiya ID (transaction_id) bilan o'tkazma allaqachon mavjud",
        );
      }
      throw err;
    }

    const affectedAppIds = new Set<string>();
    if (previousAppId) affectedAppIds.add(previousAppId);
    if (transfer.application_id) affectedAppIds.add(transfer.application_id);
    for (const appId of affectedAppIds) {
      await this.intelligenceSync?.syncApplicationById(appId);
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const transfer = await this.findOne(id);
    const affectedAppId = transfer.application_id;
    await assertNoDependencies(
      this.transferRepo.manager,
      `«${transfer.transaction_id || transfer.id.slice(0, 8)}» pul o'tkazmasi`,
      transfer.id,
      [
        {
          table: 'applications',
          column: 'transfer_id',
          label: 'ariza',
          extraWhere: 'is_deleted = false',
        },
        {
          table: 'application_custom_fields',
          column: 'transfer_id',
          label: "ariza qo'shimcha maydoni",
        },
      ],
    );
    await this.transferRepo.remove(transfer);
    if (affectedAppId) {
      await this.intelligenceSync?.syncApplicationById(affectedAppId);
    }
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
    currentUser?: JwtAccessPayload,
  ): Promise<void> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const qb = this.buildTransfersFilterQuery(search, filters);
    this.applyDistrictScope(qb, allowedDistrictIds);
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
              receiver_identifier: true,
              application: { district: true, citizen: true },
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

  async getStats(currentUser?: JwtAccessPayload): Promise<{
    total: number;
    totalAmountUzs: number;
    avgAmountUzs: number;
    successCount: number;
    pendingCount: number;
    cancelledCount: number;
    cardToCardCount: number;
    cryptoCount: number;
    otherChannelCount: number;
    topProviders: Array<{
      id: string;
      name: string;
      count: number;
      totalAmount: number;
      percent: number;
    }>;
  }> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);

    const summaryQb = this.transferRepo
      .createQueryBuilder('transfer')
      .select('COUNT(transfer.id)', 'total')
      .addSelect(
        `COALESCE(SUM(CASE WHEN UPPER(COALESCE(transfer.currency, 'UZS')) = 'UZS' THEN transfer.amount ELSE 0 END), 0)`,
        'totalAmountUzs',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE UPPER(COALESCE(transfer.currency, 'UZS')) = 'UZS' AND COALESCE(transfer.amount, 0) > 0)`,
        'uzsCount',
      )
      .addSelect(`COUNT(*) FILTER (WHERE transfer.status = 'MUVAFFAQIYATLI')`, 'successCount')
      .addSelect(`COUNT(*) FILTER (WHERE transfer.status = 'KUTILMOQDA')`, 'pendingCount')
      .addSelect(`COUNT(*) FILTER (WHERE transfer.status = 'BEKOR_QILINDI')`, 'cancelledCount')
      .addSelect(
        `COUNT(*) FILTER (WHERE COALESCE(transfer.destination_type, 'CARD') = 'CARD' AND COALESCE(transfer.destination_details->>'source_type', '') <> 'CRYPTO')`,
        'cardToCardCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE transfer.destination_type = 'CRYPTO' OR COALESCE(transfer.destination_details->>'source_type', '') = 'CRYPTO')`,
        'cryptoCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE COALESCE(transfer.destination_type, 'CARD') NOT IN ('CARD', 'CRYPTO') AND COALESCE(transfer.destination_details->>'source_type', '') <> 'CRYPTO')`,
        'otherChannelCount',
      );
    this.applyDistrictScope(summaryQb, allowedDistrictIds);

    const provQb = this.transferRepo
      .createQueryBuilder('transfer')
      .innerJoin('transfer.payment_provider', 'provider')
      .select('provider.id', 'id')
      .addSelect('provider.name', 'name')
      .addSelect('COUNT(transfer.id)', 'count')
      .addSelect(
        `COALESCE(SUM(CASE WHEN UPPER(COALESCE(transfer.currency, 'UZS')) = 'UZS' THEN transfer.amount ELSE 0 END), 0)`,
        'totalAmount',
      )
      .groupBy('provider.id')
      .addGroupBy('provider.name')
      .orderBy('COUNT(transfer.id)', 'DESC')
      .limit(5);
    this.applyDistrictScope(provQb, allowedDistrictIds);

    const [rawSummary, rawProviders] = await Promise.all([
      summaryQb.getRawOne<Record<string, string | null>>(),
      provQb.getRawMany<{
        id: string;
        name: string | null;
        count: string;
        totalAmount: string;
      }>(),
    ]);

    const total = Number(rawSummary?.total) || 0;
    const totalAmountUzs = Number(rawSummary?.totalAmountUzs) || 0;
    const uzsCount = Number(rawSummary?.uzsCount) || 0;

    const topProviders = rawProviders.map((row) => {
      const count = Number(row.count) || 0;
      return {
        id: row.id,
        name: row.name || 'Noma‘lum tizim',
        count,
        totalAmount: Number(row.totalAmount) || 0,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });

    return {
      total,
      totalAmountUzs,
      avgAmountUzs: uzsCount > 0 ? Math.round(totalAmountUzs / uzsCount) : 0,
      successCount: Number(rawSummary?.successCount) || 0,
      pendingCount: Number(rawSummary?.pendingCount) || 0,
      cancelledCount: Number(rawSummary?.cancelledCount) || 0,
      cardToCardCount: Number(rawSummary?.cardToCardCount) || 0,
      cryptoCount: Number(rawSummary?.cryptoCount) || 0,
      otherChannelCount: Number(rawSummary?.otherChannelCount) || 0,
      topProviders,
    };
  }
}
