import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { ApplicationStatus } from '../../common/enums/application-status.enum';
import { TransferCustomFieldType } from '../../common/enums/transfer-custom-field-type.enum';
import type { PaginatedResult } from '../../common/interfaces/pagination.interface';
import { Application } from './application.entity';
import { Citizen } from './citizens/citizen.entity';
import { Crime } from './crimes/crime.entity';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { District } from './districts/district.entity';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { UpdateApplicationDto } from './dto/update-application.dto';
import { Bank } from './transfers/banks/bank.entity';
import { Card } from './transfers/cards/card.entity';
import { TransferCustomField } from './transfers/custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './transfers/payment_providers/payment_provider.entity';
import { Transfer } from './transfers/transfer.entity';

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(ApplicationCustomField)
    private readonly customFieldRepo: Repository<ApplicationCustomField>,
    @InjectRepository(Citizen)
    private readonly citizenRepo: Repository<Citizen>,
    @InjectRepository(Crime)
    private readonly crimeRepo: Repository<Crime>,
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    @InjectRepository(Card)
    private readonly cardRepo: Repository<Card>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(Bank)
    private readonly bankRepo: Repository<Bank>,
    @InjectRepository(PaymentProvider)
    private readonly paymentProviderRepo: Repository<PaymentProvider>,
    @InjectRepository(TransferCustomField)
    private readonly transferCustomFieldRepo: Repository<TransferCustomField>,
  ) {}

  private async processCustomFields(
    fields: NonNullable<CreateApplicationDto['custom_fields']>,
    applicationId: string,
  ): Promise<ApplicationCustomField[]> {
    const entities: ApplicationCustomField[] = [];

    for (const f of fields) {
      let citizenId = f.citizen_id || null;
      let cardId = f.card_id || null;
      let crimeId = f.crime_id || null;
      let districtId = f.district_id || null;
      let transferId = f.transfer_id || null;

      // 1. Yangi yoki mavjud Fuqaro (inline_citizen)
      if (f.inline_citizen && !citizenId) {
        const cData = f.inline_citizen as Record<string, string>;
        let existingCitizen: Citizen | null = null;
        if (cData.passport) {
          existingCitizen = await this.citizenRepo.findOne({ where: { passport: cData.passport } });
        }
        if (!existingCitizen && cData.pinfl) {
          existingCitizen = await this.citizenRepo.findOne({ where: { pinfl: cData.pinfl } });
        }
        if (!existingCitizen && cData.phone_number) {
          existingCitizen = await this.citizenRepo.findOne({
            where: { phone_number: cData.phone_number },
          });
        }

        if (existingCitizen) {
          citizenId = existingCitizen.id;
        } else {
          const createdCitizen = this.citizenRepo.create(cData);
          const savedCitizen = await this.citizenRepo.save(createdCitizen);
          citizenId = savedCitizen.id;
        }
      }

      // 2. Yangi yoki mavjud Karta (inline_card)
      if (f.inline_card && !cardId) {
        const cdData = f.inline_card as Record<string, string>;
        if (cdData.card_number) {
          const cleaned = cdData.card_number.replace(/\D/g, '');
          const existingCard = await this.cardRepo.findOne({ where: { card_number: cleaned } });
          if (existingCard) {
            cardId = existingCard.id;
          } else {
            let bankId = cdData.bank_id || null;
            if (!bankId && cdData.bank_name) {
              let existingBank = await this.bankRepo.findOne({ where: { name: cdData.bank_name } });
              if (!existingBank) {
                existingBank = await this.bankRepo.save(
                  this.bankRepo.create({
                    name: cdData.bank_name,
                    mfo: cdData.bank_mfo || null,
                  }),
                );
              }
              bankId = existingBank.id;
            }

            const createdCard = this.cardRepo.create({
              card_number: cleaned,
              expire_date: cdData.expire_date || null,
              bank_id: bankId,
              citizen_id: citizenId || cdData.citizen_id || null,
            });
            const savedCard = await this.cardRepo.save(createdCard);
            cardId = savedCard.id;
          }
        }
      }

      // 3. Yangi yoki mavjud Jinoyat Moddasi (inline_crime)
      if (f.inline_crime && !crimeId) {
        const crData = f.inline_crime as Record<string, string>;
        if (crData.article) {
          const existingCrime = await this.crimeRepo.findOne({
            where: { article: crData.article },
          });
          if (existingCrime) {
            crimeId = existingCrime.id;
          } else {
            const createdCrime = this.crimeRepo.create(crData);
            const savedCrime = await this.crimeRepo.save(createdCrime);
            crimeId = savedCrime.id;
          }
        }
      }

      // 4. Yangi yoki mavjud Tuman (inline_district)
      if (f.inline_district && !districtId) {
        const dData = f.inline_district as Record<string, string>;
        if (dData.name) {
          let existingDistrict = await this.districtRepo.findOne({ where: { name: dData.name } });
          if (!existingDistrict && dData.code) {
            existingDistrict = await this.districtRepo.findOne({ where: { code: dData.code } });
          }
          if (existingDistrict) {
            districtId = existingDistrict.id;
          } else {
            const createdDistrict = this.districtRepo.create(dData);
            const savedDistrict = await this.districtRepo.save(createdDistrict);
            districtId = savedDistrict.id;
          }
        }
      }

      // 5. Yangi inline Transfer kiritilgan bo'lsa
      if (f.inline_transfer && !transferId) {
        const tData = f.inline_transfer;
        let providerId =
          typeof tData.payment_provider_id === 'string' ? tData.payment_provider_id : null;
        if (
          !providerId &&
          typeof tData.payment_provider_name === 'string' &&
          tData.payment_provider_name.trim()
        ) {
          const provName = tData.payment_provider_name.trim();
          let existingProv = await this.paymentProviderRepo.findOne({ where: { name: provName } });
          if (!existingProv) {
            existingProv = await this.paymentProviderRepo.save(
              this.paymentProviderRepo.create({
                name: provName,
                code: provName.toLowerCase().replace(/\s+/g, '_'),
              }),
            );
          }
          providerId = existingProv.id;
        }

        let receiverCardId =
          typeof tData.receiver_card_id === 'string' ? tData.receiver_card_id : null;
        if (!receiverCardId && typeof tData.receiver_card_number === 'string') {
          const cleanedReceiver = tData.receiver_card_number.replace(/\D/g, '');
          if (cleanedReceiver.length >= 8) {
            let existingReceiverCard = await this.cardRepo.findOne({
              where: { card_number: cleanedReceiver },
            });
            if (!existingReceiverCard) {
              existingReceiverCard = await this.cardRepo.save(
                this.cardRepo.create({
                  card_number: cleanedReceiver,
                }),
              );
            }
            receiverCardId = existingReceiverCard.id;
          }
        }

        const createdTransfer = this.transferRepo.create({
          transaction_id: typeof tData.transaction_id === 'string' ? tData.transaction_id : null,
          amount: tData.amount ? Number(tData.amount) : null,
          currency: typeof tData.currency === 'string' ? tData.currency : 'UZS',
          payment_provider_id: providerId,
          receiver_card_id: receiverCardId,
          application_id: applicationId,
        });
        const savedTransfer = await this.transferRepo.save(createdTransfer);
        transferId = savedTransfer.id;

        const rawTransferFields = Array.isArray(tData.custom_fields)
          ? tData.custom_fields
          : Array.isArray(tData.transfer_custom_fields)
            ? tData.transfer_custom_fields
            : null;
        if (rawTransferFields && rawTransferFields.length > 0) {
          const tFields = rawTransferFields.map((tf: Record<string, unknown>, idx: number) =>
            this.transferCustomFieldRepo.create({
              transfer_id: savedTransfer.id,
              label: typeof tf.label === 'string' ? tf.label : 'Qo‘shimcha ma‘lumot',
              key: typeof tf.key === 'string' ? tf.key : `field_${idx}`,
              type: (typeof tf.type === 'string'
                ? tf.type
                : TransferCustomFieldType.TEXT) as TransferCustomFieldType,
              value: tf.value ?? null,
              card_id: typeof tf.card_id === 'string' ? tf.card_id : null,
              citizen_id: typeof tf.citizen_id === 'string' ? tf.citizen_id : null,
              bank_id: typeof tf.bank_id === 'string' ? tf.bank_id : null,
              payment_provider_id:
                typeof tf.payment_provider_id === 'string' ? tf.payment_provider_id : null,
              order: idx,
            }),
          );
          await this.transferCustomFieldRepo.save(tFields);
        }
      }

      entities.push(
        this.customFieldRepo.create({
          application_id: applicationId,
          label: f.label || null,
          key: f.key || null,
          type: f.type || null,
          value: f.value ?? null,
          citizen_id: citizenId,
          card_id: cardId,
          crime_id: crimeId,
          district_id: districtId,
          transfer_id: transferId,
          order: f.order ?? 0,
        }),
      );
    }

    return entities;
  }

  private async resolvePrimaryModels(
    dto: CreateApplicationDto | UpdateApplicationDto,
    applicationId?: string,
  ): Promise<{
    citizen_id?: string | null;
    district_id?: string | null;
    crime_id?: string | null;
    card_id?: string | null;
    transfer_id?: string | null;
  }> {
    let citizenId = dto.citizen_id || null;
    let districtId = dto.district_id || null;
    let crimeId = dto.crime_id || null;
    let cardId = dto.card_id || null;
    let transferId = dto.transfer_id || null;

    // 1. Fuqaro (Agar citizen_id berilmagan bo'lsa, lekin citizen_data bo'lsa)
    if (!citizenId && dto.citizen_data && Object.keys(dto.citizen_data).length > 0) {
      const data = dto.citizen_data as Record<string, string>;
      if (data.first_name || data.passport || data.phone_number) {
        let existingCitizen: Citizen | null = null;
        if (data.passport) {
          existingCitizen = await this.citizenRepo.findOne({ where: { passport: data.passport } });
        }
        if (!existingCitizen && data.pinfl) {
          existingCitizen = await this.citizenRepo.findOne({ where: { pinfl: data.pinfl } });
        }
        if (!existingCitizen && data.phone_number && data.first_name && data.last_name) {
          existingCitizen = await this.citizenRepo.findOne({
            where: {
              phone_number: data.phone_number,
              first_name: data.first_name,
              last_name: data.last_name,
            },
          });
        }

        if (existingCitizen) {
          citizenId = existingCitizen.id;
        } else {
          const newCitizen = this.citizenRepo.create(data);
          const saved = await this.citizenRepo.save(newCitizen);
          citizenId = saved.id;
        }
      }
    }

    // 2. Tuman
    if (!districtId && dto.district_data && Object.keys(dto.district_data).length > 0) {
      const data = dto.district_data as Record<string, string>;
      if (data.name) {
        let existingDistrict = await this.districtRepo.findOne({ where: { name: data.name } });
        if (!existingDistrict && data.code) {
          existingDistrict = await this.districtRepo.findOne({ where: { code: data.code } });
        }
        if (existingDistrict) {
          districtId = existingDistrict.id;
        } else {
          const newDistrict = this.districtRepo.create(data);
          const saved = await this.districtRepo.save(newDistrict);
          districtId = saved.id;
        }
      }
    }

    // 3. Jinoyat moddasi
    if (!crimeId && dto.crime_data && Object.keys(dto.crime_data).length > 0) {
      const data = dto.crime_data as Record<string, string>;
      if (data.article) {
        const existingCrime = await this.crimeRepo.findOne({ where: { article: data.article } });
        if (existingCrime) {
          crimeId = existingCrime.id;
        } else {
          const newCrime = this.crimeRepo.create(data);
          const saved = await this.crimeRepo.save(newCrime);
          crimeId = saved.id;
        }
      }
    }

    // 4. Plastik karta (Asosiy / Jabrlanuvchi kartasi)
    if (!cardId && dto.card_data && Object.keys(dto.card_data).length > 0) {
      const data = dto.card_data as Record<string, string>;
      if (data.card_number) {
        const cleaned = data.card_number.replace(/\D/g, '');
        const existingCard = await this.cardRepo.findOne({ where: { card_number: cleaned } });
        if (existingCard) {
          cardId = existingCard.id;
        } else {
          // Bank ma'lumoti kiritilgan bo'lsa, bankni topamiz yoki yaratamiz
          let bankId = data.bank_id || null;
          if (!bankId && data.bank_name) {
            let existingBank = await this.bankRepo.findOne({ where: { name: data.bank_name } });
            if (!existingBank) {
              existingBank = await this.bankRepo.save(
                this.bankRepo.create({ name: data.bank_name }),
              );
            }
            bankId = existingBank.id;
          }

          const newCard = this.cardRepo.create({
            card_number: cleaned,
            expire_date: data.expire_date || null,
            bank_id: bankId,
            citizen_id: citizenId || data.citizen_id || null,
          });
          const saved = await this.cardRepo.save(newCard);
          cardId = saved.id;
        }
      }
    }

    // 5. To'lov o'tkazmasi (Transfer)
    if (!transferId && dto.transfer_data && Object.keys(dto.transfer_data).length > 0) {
      const data = dto.transfer_data;
      if (data.amount) {
        // A. Payment Provider (To'lov tizimi: Payme, Click, Uzum...)
        let providerId =
          typeof data.payment_provider_id === 'string' ? data.payment_provider_id : null;
        if (
          !providerId &&
          typeof data.payment_provider_name === 'string' &&
          data.payment_provider_name.trim()
        ) {
          const provName = data.payment_provider_name.trim();
          let existingProv = await this.paymentProviderRepo.findOne({ where: { name: provName } });
          if (!existingProv) {
            existingProv = await this.paymentProviderRepo.save(
              this.paymentProviderRepo.create({
                name: provName,
                code: provName.toLowerCase().replace(/\s+/g, '_'),
              }),
            );
          }
          providerId = existingProv.id;
        }

        // B. Qabul qiluvchi karta (Pul tushgan firibgar kartasi)
        let receiverCardId =
          typeof data.receiver_card_id === 'string' ? data.receiver_card_id : null;
        if (!receiverCardId && typeof data.receiver_card_number === 'string') {
          const cleanedReceiver = data.receiver_card_number.replace(/\D/g, '');
          if (cleanedReceiver.length >= 8) {
            let existingReceiverCard = await this.cardRepo.findOne({
              where: { card_number: cleanedReceiver },
            });
            if (!existingReceiverCard) {
              let receiverBankId =
                typeof data.receiver_bank_id === 'string' ? data.receiver_bank_id : null;
              if (
                !receiverBankId &&
                typeof data.receiver_bank_name === 'string' &&
                data.receiver_bank_name.trim()
              ) {
                const bName = data.receiver_bank_name.trim();
                let b = await this.bankRepo.findOne({ where: { name: bName } });
                if (!b) {
                  b = await this.bankRepo.save(this.bankRepo.create({ name: bName }));
                }
                receiverBankId = b.id;
              }

              existingReceiverCard = await this.cardRepo.save(
                this.cardRepo.create({
                  card_number: cleanedReceiver,
                  expire_date:
                    typeof data.receiver_card_expire === 'string'
                      ? data.receiver_card_expire
                      : null,
                  bank_id: receiverBankId,
                }),
              );
            }
            receiverCardId = existingReceiverCard.id;
          }
        }

        // C. Yangi Transfer yaratamiz
        const newTransfer = this.transferRepo.create({
          transaction_id: typeof data.transaction_id === 'string' ? data.transaction_id : null,
          amount: Number(data.amount),
          currency: typeof data.currency === 'string' ? data.currency : 'UZS',
          payment_provider_id: providerId,
          receiver_card_id: receiverCardId,
          sender_card_id:
            cardId || (typeof data.sender_card_id === 'string' ? data.sender_card_id : null),
          application_id: applicationId || null,
        });
        const savedTransfer = await this.transferRepo.save(newTransfer);
        transferId = savedTransfer.id;

        // D. Transfer Custom Fields (Chek rasmlari, kvitansiya havolalari, sub-modellar)
        const rawTransferFields = Array.isArray(data.custom_fields)
          ? data.custom_fields
          : Array.isArray(data.transfer_custom_fields)
            ? data.transfer_custom_fields
            : null;
        if (rawTransferFields && rawTransferFields.length > 0) {
          const tFields = rawTransferFields.map((tf: Record<string, unknown>, idx: number) =>
            this.transferCustomFieldRepo.create({
              transfer_id: savedTransfer.id,
              label: typeof tf.label === 'string' ? tf.label : 'Qo‘shimcha ma‘lumot',
              key: typeof tf.key === 'string' ? tf.key : `field_${idx}`,
              type: (typeof tf.type === 'string'
                ? tf.type
                : TransferCustomFieldType.STRING) as TransferCustomFieldType,
              value: tf.value ?? null,
              card_id: typeof tf.card_id === 'string' ? tf.card_id : null,
              citizen_id: typeof tf.citizen_id === 'string' ? tf.citizen_id : null,
              bank_id: typeof tf.bank_id === 'string' ? tf.bank_id : null,
              payment_provider_id:
                typeof tf.payment_provider_id === 'string' ? tf.payment_provider_id : null,
              order: idx,
            }),
          );
          await this.transferCustomFieldRepo.save(tFields);
        }
      }
    }

    return {
      citizen_id: citizenId,
      district_id: districtId,
      crime_id: crimeId,
      card_id: cardId,
      transfer_id: transferId,
    };
  }

  async create(dto: CreateApplicationDto): Promise<Application> {
    const { custom_fields, date, ...applicationData } = dto;

    // 1. Agar ariza raqami ko'rsatilmagan bo'lsa, avtomatik yaratamiz: 2026-00001
    let appNumber = applicationData.application_number;
    if (!appNumber) {
      const year = new Date().getFullYear();
      const count = await this.applicationRepo.count();
      appNumber = `${year}-${String(count + 1).padStart(5, '0')}`;
    }

    const resolved = await this.resolvePrimaryModels(dto);

    const application = this.applicationRepo.create({
      ...applicationData,
      ...resolved,
      application_number: appNumber,
      date: date ? new Date(date) : new Date(),
    });

    const saved = await this.applicationRepo.save(application);

    // 2. Dinamik maydonlar (Custom Fields) ni saqlaymiz
    if (custom_fields && custom_fields.length > 0) {
      const fieldEntities = await this.processCustomFields(custom_fields, saved.id);
      await this.customFieldRepo.save(fieldEntities);
    }

    return this.findOne(saved.id);
  }

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    status?: string,
  ): Promise<PaginatedResult<Application>> {
    const where: FindOptionsWhere<Application> = {};
    if (status) {
      where.status = status as ApplicationStatus;
    }

    const take = limit;
    const skip = (page - 1) * limit;

    let whereCondition: FindOptionsWhere<Application> | FindOptionsWhere<Application>[] = where;

    if (search) {
      const q = `%${search}%`;
      whereCondition = [
        { ...where, application_number: ILike(q) },
        { ...where, title: ILike(q) },
        { ...where, description: ILike(q) },
      ];
    }

    const [items, total] = await this.applicationRepo.findAndCount({
      where: whereCondition,
      relations: {
        citizen: true,
        district: true,
        crime: true,
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: true,
          receiver_card: true,
          custom_fields: {
            bank: true,
            card: true,
            citizen: true,
          },
        },
        custom_fields: {
          citizen: true,
          card: { bank: true, citizen: true },
          crime: true,
          district: true,
          transfer: {
            payment_provider: true,
            sender_card: true,
            receiver_card: true,
          },
        },
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

  async findOne(id: string): Promise<Application> {
    const application = await this.applicationRepo.findOne({
      where: { id },
      relations: {
        citizen: true,
        district: true,
        crime: true,
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: true,
          receiver_card: true,
          custom_fields: {
            bank: true,
            card: true,
            citizen: true,
          },
        },
        custom_fields: {
          citizen: true,
          card: { bank: true, citizen: true },
          crime: true,
          district: true,
          transfer: {
            payment_provider: true,
            sender_card: true,
            receiver_card: true,
          },
        },
      },
    });

    if (!application) {
      throw new NotFoundException(`Ariza (ID: ${id}) topilmadi`);
    }

    return application;
  }

  async update(id: string, dto: UpdateApplicationDto): Promise<Application> {
    const application = await this.findOne(id);
    const { custom_fields, date, ...applicationData } = dto;

    const resolved = await this.resolvePrimaryModels(dto, id);

    Object.assign(application, applicationData, resolved);
    if (date) {
      application.date = new Date(date);
    }

    await this.applicationRepo.save(application);

    if (custom_fields !== undefined) {
      await this.customFieldRepo.delete({ application_id: id });
      if (custom_fields.length > 0) {
        const fieldEntities = await this.processCustomFields(custom_fields, id);
        await this.customFieldRepo.save(fieldEntities);
      }
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const application = await this.findOne(id);
    await this.applicationRepo.remove(application);
    return { success: true, message: "Ariza muvaffaqiyatli o'chirildi" };
  }
}
