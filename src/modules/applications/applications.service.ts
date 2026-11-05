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
import { Mahalla } from './mahallas/mahalla.entity';
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
    @InjectRepository(Mahalla)
    private readonly mahallaRepo: Repository<Mahalla>,
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
              full_name: cdData.full_name || null,
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
        const dName = (dData.name || '').trim();
        if (dName) {
          const existingDistrict = await this.districtRepo.findOne({
            where: { name: ILike(dName) },
          });
          if (existingDistrict) {
            districtId = existingDistrict.id;
          } else {
            const createdDistrict = this.districtRepo.create({ name: dName });
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
            let receiverBankId =
              typeof tData.receiver_bank_id === 'string' ? tData.receiver_bank_id : null;
            if (
              !receiverBankId &&
              typeof tData.receiver_bank_name === 'string' &&
              tData.receiver_bank_name.trim()
            ) {
              const bName = tData.receiver_bank_name.trim();
              let b = await this.bankRepo.findOne({ where: { name: bName } });
              if (!b) {
                b = await this.bankRepo.save(this.bankRepo.create({ name: bName }));
              }
              receiverBankId = b.id;
            }

            const recFullName =
              typeof tData.receiver_card_full_name === 'string'
                ? tData.receiver_card_full_name
                : typeof tData.receiver_full_name === 'string'
                  ? tData.receiver_full_name
                  : null;

            if (!existingReceiverCard) {
              existingReceiverCard = await this.cardRepo.save(
                this.cardRepo.create({
                  card_number: cleanedReceiver,
                  full_name: recFullName,
                  bank_id: receiverBankId,
                }),
              );
            } else if (recFullName && !existingReceiverCard.full_name) {
              existingReceiverCard.full_name = recFullName;
              await this.cardRepo.save(existingReceiverCard);
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
          sender_card_id: cardId || null,
          application_id: applicationId,
          transfer_date: typeof tData.transfer_date === 'string' ? tData.transfer_date : null,
          transfer_time: typeof tData.transfer_time === 'string' ? tData.transfer_time : null,
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

    // 1. Fuqaro (Agar citizen_id berilgan yoki berilmagan bo'lsa)
    if (citizenId && dto.citizen_data && Object.keys(dto.citizen_data).length > 0) {
      const data = dto.citizen_data as Record<string, string | null | undefined>;
      const existing = await this.citizenRepo.findOne({ where: { id: citizenId } });
      if (existing) {
        let citDistrictId = data.district_id || null;
        if (!citDistrictId && typeof data.district_name === 'string' && data.district_name.trim()) {
          const dName = data.district_name.trim();
          let d = await this.districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await this.districtRepo.save(this.districtRepo.create({ name: dName }));
          }
          citDistrictId = d.id;
        }

        let citMahallaId = data.mahalla_id || null;
        if (
          !citMahallaId &&
          typeof data.mahalla_name === 'string' &&
          data.mahalla_name.trim() &&
          citDistrictId
        ) {
          const mName = data.mahalla_name.trim();
          let m = await this.mahallaRepo.findOne({
            where: { name: ILike(mName), district_id: citDistrictId },
          });
          if (!m) {
            m = await this.mahallaRepo.save(
              this.mahallaRepo.create({ name: mName, district_id: citDistrictId }),
            );
          }
          citMahallaId = m.id;
        }

        if (citDistrictId !== null || data.district_id !== undefined)
          existing.district_id = citDistrictId;
        if (citMahallaId !== null || data.mahalla_id !== undefined)
          existing.mahalla_id = citMahallaId;
        if (data.address !== undefined) existing.address = data.address || null;
        await this.citizenRepo.save(existing);
      }
    } else if (!citizenId && dto.citizen_data && Object.keys(dto.citizen_data).length > 0) {
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

        let citDistrictId = data.district_id || null;
        if (!citDistrictId && typeof data.district_name === 'string' && data.district_name.trim()) {
          const dName = data.district_name.trim();
          let d = await this.districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await this.districtRepo.save(this.districtRepo.create({ name: dName }));
          }
          citDistrictId = d.id;
        }

        let citMahallaId = data.mahalla_id || null;
        if (
          !citMahallaId &&
          typeof data.mahalla_name === 'string' &&
          data.mahalla_name.trim() &&
          citDistrictId
        ) {
          const mName = data.mahalla_name.trim();
          let m = await this.mahallaRepo.findOne({
            where: { name: ILike(mName), district_id: citDistrictId },
          });
          if (!m) {
            m = await this.mahallaRepo.save(
              this.mahallaRepo.create({ name: mName, district_id: citDistrictId }),
            );
          }
          citMahallaId = m.id;
        }

        if (existingCitizen) {
          if (citDistrictId !== null || data.district_id !== undefined)
            existingCitizen.district_id = citDistrictId;
          if (citMahallaId !== null || data.mahalla_id !== undefined)
            existingCitizen.mahalla_id = citMahallaId;
          if (data.address !== undefined) existingCitizen.address = data.address || null;
          await this.citizenRepo.save(existingCitizen);
          citizenId = existingCitizen.id;
        } else {
          const newCitizen = this.citizenRepo.create({
            ...data,
            district_id: citDistrictId,
            mahalla_id: citMahallaId,
          });
          const saved = await this.citizenRepo.save(newCitizen);
          citizenId = saved.id;
        }
      }
    }

    // 2. Tuman
    if (!districtId && dto.district_data && Object.keys(dto.district_data).length > 0) {
      const data = dto.district_data as Record<string, string>;
      const dName = (data.name || '').trim();
      if (dName) {
        const existingDistrict = await this.districtRepo.findOne({ where: { name: ILike(dName) } });
        if (existingDistrict) {
          districtId = existingDistrict.id;
        } else {
          const newDistrict = this.districtRepo.create({ name: dName });
          const saved = await this.districtRepo.save(newDistrict);
          districtId = saved.id;
        }
      }
    }

    // 3. Jinoyat turi
    if (!crimeId && dto.crime_data && Object.keys(dto.crime_data).length > 0) {
      const data = dto.crime_data as Record<string, string>;
      const crimeName = (data.article || data.title || '').trim();
      if (crimeName) {
        const existingCrime = await this.crimeRepo.findOne({
          where: [{ article: crimeName }, { title: crimeName }],
        });
        if (existingCrime) {
          crimeId = existingCrime.id;
        } else {
          const newCrime = this.crimeRepo.create({
            article: crimeName,
            title: crimeName,
          });
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
          if (data.full_name && !existingCard.full_name) {
            existingCard.full_name = data.full_name;
            await this.cardRepo.save(existingCard);
          }
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
            full_name: data.full_name || null,
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
      if (data.amount || data.receiver_card_number || data.transfer_date) {
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

            const recFullName =
              typeof data.receiver_card_full_name === 'string'
                ? data.receiver_card_full_name
                : typeof data.receiver_full_name === 'string'
                  ? data.receiver_full_name
                  : null;

            if (!existingReceiverCard) {
              existingReceiverCard = await this.cardRepo.save(
                this.cardRepo.create({
                  card_number: cleanedReceiver,
                  expire_date:
                    typeof data.receiver_card_expire === 'string'
                      ? data.receiver_card_expire
                      : null,
                  full_name: recFullName,
                  bank_id: receiverBankId,
                }),
              );
            } else if (recFullName && !existingReceiverCard.full_name) {
              existingReceiverCard.full_name = recFullName;
              await this.cardRepo.save(existingReceiverCard);
            }
            receiverCardId = existingReceiverCard.id;
          }
        }

        // C. Yangi Transfer yaratamiz
        const newTransfer = this.transferRepo.create({
          transaction_id: typeof data.transaction_id === 'string' ? data.transaction_id : null,
          amount: data.amount ? Number(data.amount) : null,
          currency: typeof data.currency === 'string' ? data.currency : 'UZS',
          payment_provider_id: providerId,
          receiver_card_id: receiverCardId,
          sender_card_id:
            cardId || (typeof data.sender_card_id === 'string' ? data.sender_card_id : null),
          application_id: applicationId || null,
          transfer_date: typeof data.transfer_date === 'string' ? data.transfer_date : null,
          transfer_time: typeof data.transfer_time === 'string' ? data.transfer_time : null,
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

    // 1. Ariza raqami ko'rsatilgan bo'lsa tozalab olamiz, aks holda null (auto-generate qilinmaydi)
    const appNumber = applicationData.application_number?.trim() || null;

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
        { ...where, description: ILike(q) },
        { ...where, officer_notes: ILike(q) },
      ];
    }

    const [items, total] = await this.applicationRepo.findAndCount({
      where: whereCondition,
      relations: {
        citizen: { district: true, mahalla: true },
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
        citizen: { district: true, mahalla: true },
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
    if (applicationData.application_number !== undefined) {
      application.application_number = applicationData.application_number
        ? applicationData.application_number.trim()
        : null;
    }
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

  async getStatistics(period = 'month', startDate?: string, endDate?: string) {
    const now = new Date();
    let start: Date;
    let end: Date = new Date();

    if (period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (period === 'week') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    } else if (period === 'custom' && startDate) {
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      if (endDate) {
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      }
    } else if (period === 'all') {
      start = new Date(2020, 0, 1, 0, 0, 0, 0);
    } else {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    }

    const durationMs = Math.max(end.getTime() - start.getTime(), 1000);
    const prevStart = new Date(start.getTime() - durationMs);
    const prevEnd = new Date(start.getTime() - 1);

    // 1. Current period applications with relations
    const applications = await this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.crime', 'crime')
      .leftJoinAndSelect('transfer.payment_provider', 'payment_provider')
      .leftJoinAndSelect('app.custom_fields', 'custom_fields')
      .where('COALESCE(app.date, app.created_at) BETWEEN :start AND :end', { start, end })
      .orderBy('COALESCE(app.date, app.created_at)', 'ASC')
      .getMany();

    // 2. Previous period summary for comparison
    const prevRaw = await this.applicationRepo
      .createQueryBuilder('app')
      .leftJoin('app.transfer', 'transfer')
      .select('COUNT(app.id)', 'count')
      .addSelect('COALESCE(SUM(transfer.amount), 0)', 'loss')
      .where('COALESCE(app.date, app.created_at) BETWEEN :prevStart AND :prevEnd', {
        prevStart,
        prevEnd,
      })
      .getRawOne<{ count?: string | number; loss?: string | number }>();

    const prevCount = Number(prevRaw?.count ?? 0);
    const prevLoss = Number(prevRaw?.loss ?? 0);

    // 3. Summaries computation
    let totalLoss = 0;
    let resolvedLoss = 0;
    let maxLoss = 0;
    let newCount = 0;
    let inProgressCount = 0;
    let resolvedCount = 0;
    let rejectedCount = 0;

    const districtMap = new Map<
      string,
      { id: string; name: string; count: number; totalLoss: number }
    >();
    const crimeMap = new Map<
      string,
      { id: string; article: string; title: string | null; gravity: string | null; count: number }
    >();
    const providerMap = new Map<string, { name: string; count: number; totalAmount: number }>();

    for (const app of applications) {
      if (app.status === ApplicationStatus.YANGI) newCount++;
      else if (app.status === ApplicationStatus.JARAYONDA) inProgressCount++;
      else if (app.status === ApplicationStatus.HAL_QILINDI) resolvedCount++;
      else if (app.status === ApplicationStatus.RAD_ETILDI) rejectedCount++;

      const amount = Number(app.transfer?.amount || 0);
      if (amount > 0) {
        totalLoss += amount;
        if (amount > maxLoss) maxLoss = amount;
        if (app.status === ApplicationStatus.HAL_QILINDI) {
          resolvedLoss += amount;
        }
      }

      if (app.district) {
        const d = districtMap.get(app.district.id) || {
          id: app.district.id,
          name: app.district.name || 'Noma‘lum tuman',
          count: 0,
          totalLoss: 0,
        };
        d.count++;
        d.totalLoss += amount;
        districtMap.set(app.district.id, d);
      }

      if (app.crime) {
        const c = crimeMap.get(app.crime.id) || {
          id: app.crime.id,
          article: app.crime.article || 'Noma‘lum modda',
          title: app.crime.title || null,
          gravity: app.crime.gravity || null,
          count: 0,
        };
        c.count++;
        crimeMap.set(app.crime.id, c);
      }

      if (app.transfer?.payment_provider) {
        const pName = app.transfer.payment_provider.name || 'Boshqa';
        const p = providerMap.get(pName) || { name: pName, count: 0, totalAmount: 0 };
        p.count++;
        p.totalAmount += amount;
        providerMap.set(pName, p);
      }
    }

    const totalApplications = applications.length;
    const avgLoss = totalApplications > 0 ? Math.round(totalLoss / totalApplications) : 0;
    const resolutionRate =
      totalApplications > 0 ? Math.round((resolvedCount / totalApplications) * 100) : 0;

    const totalPercentChange =
      prevCount === 0
        ? totalApplications > 0
          ? 100
          : 0
        : Math.round(((totalApplications - prevCount) / prevCount) * 100);

    const lossPercentChange =
      prevLoss === 0
        ? totalLoss > 0
          ? 100
          : 0
        : Math.round(((totalLoss - prevLoss) / prevLoss) * 100);

    // 4. Timeline buckets
    const timeline: Array<{
      date: string;
      label: string;
      total: number;
      resolved: number;
      in_progress: number;
      new: number;
      loss: number;
    }> = [];

    const durationDays = durationMs / (1000 * 60 * 60 * 24);

    if (period === 'today') {
      for (let h = 0; h < 24; h += 2) {
        const hourStr = `${String(h).padStart(2, '0')}:00`;
        timeline.push({
          date: hourStr,
          label: hourStr,
          total: 0,
          resolved: 0,
          in_progress: 0,
          new: 0,
          loss: 0,
        });
      }
      for (const app of applications) {
        const appDate = new Date(app.date || app.created_at);
        const h = appDate.getHours();
        const bucketIndex = Math.min(Math.floor(h / 2), timeline.length - 1);
        if (timeline[bucketIndex]) {
          timeline[bucketIndex].total++;
          timeline[bucketIndex].loss += Number(app.transfer?.amount || 0);
          if (app.status === ApplicationStatus.HAL_QILINDI) timeline[bucketIndex].resolved++;
          else if (app.status === ApplicationStatus.JARAYONDA) timeline[bucketIndex].in_progress++;
          else if (app.status === ApplicationStatus.YANGI) timeline[bucketIndex].new++;
        }
      }
    } else if (durationDays <= 35) {
      const cur = new Date(start);
      const months = [
        'Yan',
        'Fev',
        'Mar',
        'Apr',
        'May',
        'Iyn',
        'Iyl',
        'Avg',
        'Sen',
        'Okt',
        'Noy',
        'Dek',
      ];
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;
        const label = `${d} ${months[cur.getMonth()]}`;
        timeline.push({
          date: key,
          label,
          total: 0,
          resolved: 0,
          in_progress: 0,
          new: 0,
          loss: 0,
        });
        cur.setDate(cur.getDate() + 1);
      }

      const timelineMap = new Map<string, (typeof timeline)[0]>();
      timeline.forEach((t) => timelineMap.set(t.date, t));

      for (const app of applications) {
        const appDate = new Date(app.date || app.created_at);
        const key = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, '0')}-${String(appDate.getDate()).padStart(2, '0')}`;
        const item = timelineMap.get(key);
        if (item) {
          item.total++;
          item.loss += Number(app.transfer?.amount || 0);
          if (app.status === ApplicationStatus.HAL_QILINDI) item.resolved++;
          else if (app.status === ApplicationStatus.JARAYONDA) item.in_progress++;
          else if (app.status === ApplicationStatus.YANGI) item.new++;
        }
      }
    } else {
      const cur = new Date(start);
      cur.setDate(1);
      const months = [
        'Yanvar',
        'Fevral',
        'Mart',
        'Aprel',
        'May',
        'Iyun',
        'Iyul',
        'Avgust',
        'Sentabr',
        'Oktabr',
        'Noyabr',
        'Dekabr',
      ];
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const key = `${y}-${m}`;
        const label = `${months[cur.getMonth()]} ${y}`;
        timeline.push({
          date: key,
          label,
          total: 0,
          resolved: 0,
          in_progress: 0,
          new: 0,
          loss: 0,
        });
        cur.setMonth(cur.getMonth() + 1);
      }

      const timelineMap = new Map<string, (typeof timeline)[0]>();
      timeline.forEach((t) => timelineMap.set(t.date, t));

      for (const app of applications) {
        const appDate = new Date(app.date || app.created_at);
        const key = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, '0')}`;
        const item = timelineMap.get(key);
        if (item) {
          item.total++;
          item.loss += Number(app.transfer?.amount || 0);
          if (app.status === ApplicationStatus.HAL_QILINDI) item.resolved++;
          else if (app.status === ApplicationStatus.JARAYONDA) item.in_progress++;
          else if (app.status === ApplicationStatus.YANGI) item.new++;
        }
      }
    }

    // 5. byStatus
    const byStatus = [
      {
        status: ApplicationStatus.YANGI,
        label: 'Yangi',
        count: newCount,
        percent: totalApplications > 0 ? Math.round((newCount / totalApplications) * 100) : 0,
        color: '#3b82f6',
      },
      {
        status: ApplicationStatus.JARAYONDA,
        label: 'Jarayonda',
        count: inProgressCount,
        percent:
          totalApplications > 0 ? Math.round((inProgressCount / totalApplications) * 100) : 0,
        color: '#f59e0b',
      },
      {
        status: ApplicationStatus.HAL_QILINDI,
        label: 'Hal qilindi',
        count: resolvedCount,
        percent: totalApplications > 0 ? Math.round((resolvedCount / totalApplications) * 100) : 0,
        color: '#10b981',
      },
      {
        status: ApplicationStatus.RAD_ETILDI,
        label: 'Rad etildi',
        count: rejectedCount,
        percent: totalApplications > 0 ? Math.round((rejectedCount / totalApplications) * 100) : 0,
        color: '#ef4444',
      },
    ];

    // 6. byDistrict
    const byDistrict = Array.from(districtMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((d) => ({
        ...d,
        percent: totalApplications > 0 ? Math.round((d.count / totalApplications) * 100) : 0,
      }));

    // 7. byCrime
    const byCrime = Array.from(crimeMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((c) => ({
        ...c,
        percent: totalApplications > 0 ? Math.round((c.count / totalApplications) * 100) : 0,
      }));

    // 8. byPaymentProvider
    const byPaymentProvider = Array.from(providerMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((p) => ({
        ...p,
        percent: totalLoss > 0 ? Math.round((p.totalAmount / totalLoss) * 100) : 0,
      }));

    // 9. Recent applications
    const recentApplications = [...applications]
      .sort(
        (a, b) =>
          new Date(b.date || b.created_at).getTime() - new Date(a.date || a.created_at).getTime(),
      )
      .slice(0, 6)
      .map((a) => ({
        id: a.id,
        application_number: a.application_number,
        description: a.description,
        officer_notes: a.officer_notes,
        status: a.status,
        date: a.date ? a.date.toISOString() : null,
        created_at: a.created_at.toISOString(),
        citizen_name: a.citizen
          ? `${a.citizen.last_name || ''} ${a.citizen.first_name || ''}`.trim()
          : null,
        district_name: a.district?.name || null,
        crime_article: a.crime?.article || null,
        amount: a.transfer?.amount ? Number(a.transfer.amount) : null,
      }));

    return {
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      summary: {
        totalApplications,
        newApplications: newCount,
        inProgressApplications: inProgressCount,
        resolvedApplications: resolvedCount,
        rejectedApplications: rejectedCount,
        totalLoss,
        resolvedLoss,
        avgLoss,
        maxLoss,
        resolutionRate,
        comparison: {
          totalPercentChange,
          lossPercentChange,
        },
      },
      timeline,
      byStatus,
      byDistrict,
      byCrime,
      byPaymentProvider,
      recentApplications,
    };
  }
}
