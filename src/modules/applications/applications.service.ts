import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { ILike, In, Not, Repository } from 'typeorm';

import { ApplicationStatus } from '../../common/enums/application-status.enum';
import { Role } from '../../common/enums/role.enum';
import { TransferCustomFieldType } from '../../common/enums/transfer-custom-field-type.enum';
import type { PaginatedResult } from '../../common/interfaces/pagination.interface';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { formatTitleCase, formatUzbekName } from '../../common/utils/name-formatter.util';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { IntelligenceSyncService } from '../intelligence/intelligence-sync.service';
import { User } from '../users/user.entity';
import { Application, SuspectTreeNode } from './application.entity';
import { Citizen } from './citizens/citizen.entity';
import { Crime } from './crimes/crime.entity';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { District } from './districts/district.entity';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { UpdateApplicationDto } from './dto/update-application.dto';
import { ApplicationsExcelService } from './export/applications-excel.service';
import { CyberControlShablonExcelService } from './export/cybercontrol-shablon-excel.service';
import { Mahalla } from './mahallas/mahalla.entity';
import { ApplicationStatus as ApplicationStatusEntity } from './statuses/application-status.entity';
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
    @InjectRepository(ApplicationStatusEntity)
    private readonly statusRepo: Repository<ApplicationStatusEntity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly excelService: ApplicationsExcelService,
    private readonly cyberControlExcelService: CyberControlShablonExcelService,
    private readonly intelligenceSync: IntelligenceSyncService,
    private readonly intelligenceService: IntelligenceService,
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
        const pNum = cData.phone_number ? cData.phone_number.replace(/\D/g, '') : null;
        const pass = cData.passport ? cData.passport.trim().toUpperCase() : null;
        const pinfl = cData.pinfl ? cData.pinfl.trim() : null;
        const fName = cData.first_name ? formatUzbekName(cData.first_name) : null;
        const lName = cData.last_name ? formatUzbekName(cData.last_name) : null;
        const mName = cData.middle_name ? formatUzbekName(cData.middle_name) : null;
        const addr = cData.address ? cData.address.trim() : null;

        // Tuman va Mahallani aniqlash (Unique Models)
        let citDistrictId = cData.district_id || null;
        if (
          !citDistrictId &&
          typeof cData.district_name === 'string' &&
          cData.district_name.trim()
        ) {
          const dName = cData.district_name.trim();
          let d = await this.districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await this.districtRepo.save(this.districtRepo.create({ name: dName }));
          }
          citDistrictId = d.id;
        }

        let citMahallaId = cData.mahalla_id || null;
        if (
          !citMahallaId &&
          typeof cData.mahalla_name === 'string' &&
          cData.mahalla_name.trim() &&
          citDistrictId
        ) {
          const mName = cData.mahalla_name.trim();
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

        if (fName || lName || pass || pinfl || pNum || citDistrictId || citMahallaId) {
          let existingCitizen: Citizen | null = null;
          if (pass) {
            existingCitizen = await this.citizenRepo.findOne({ where: { passport: pass } });
          }
          if (!existingCitizen && pinfl) {
            existingCitizen = await this.citizenRepo.findOne({ where: { pinfl } });
          }
          if (!existingCitizen && pNum && fName) {
            existingCitizen = await this.citizenRepo.findOne({
              where: { phone_number: pNum, first_name: fName },
            });
          }

          if (existingCitizen) {
            if (addr && !existingCitizen.address) existingCitizen.address = addr;
            if (fName) existingCitizen.first_name = fName;
            if (lName) existingCitizen.last_name = lName;
            if (mName) existingCitizen.middle_name = mName;
            if (cData.birth_date && !existingCitizen.birth_date)
              existingCitizen.birth_date = cData.birth_date;
            if (cData.gender && !existingCitizen.gender)
              existingCitizen.gender = cData.gender as 'male' | 'female';
            if (citDistrictId && !existingCitizen.district_id)
              existingCitizen.district_id = citDistrictId;
            if (citMahallaId && !existingCitizen.mahalla_id)
              existingCitizen.mahalla_id = citMahallaId;
            await this.citizenRepo.save(existingCitizen);
            citizenId = existingCitizen.id;
          } else {
            const createdCitizen = this.citizenRepo.create({
              first_name: fName,
              last_name: lName,
              middle_name: mName,
              passport: pass,
              pinfl: pinfl,
              phone_number: pNum,
              birth_date: cData.birth_date || null,
              gender: (cData.gender as 'male' | 'female') || null,
              address: addr,
              district_id: citDistrictId,
              mahalla_id: citMahallaId,
            });
            const savedCitizen = await this.citizenRepo.save(createdCitizen);
            citizenId = savedCitizen.id;
          }
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
              const bName = formatTitleCase(cdData.bank_name.trim());
              let existingBank = await this.bankRepo.findOne({ where: { name: ILike(bName) } });
              if (!existingBank) {
                existingBank = await this.bankRepo.save(
                  this.bankRepo.create({
                    name: bName,
                    mfo: cdData.bank_mfo || null,
                  }),
                );
              }
              bankId = existingBank.id;
            }

            const createdCard = this.cardRepo.create({
              card_number: cleaned,
              expire_date: cdData.expire_date || null,
              full_name: cdData.full_name ? formatUzbekName(cdData.full_name) : null,
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
          const cArt = formatTitleCase(crData.article.trim());
          const existingCrime = await this.crimeRepo.findOne({
            where: [{ article: ILike(cArt) }, { title: ILike(cArt) }],
          });
          if (existingCrime) {
            crimeId = existingCrime.id;
          } else {
            const createdCrime = this.crimeRepo.create({
              ...crData,
              article: cArt,
              title: crData.title ? formatTitleCase(crData.title) : cArt,
            });
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
          const formattedDName = formatTitleCase(dName);
          const existingDistrict = await this.districtRepo.findOne({
            where: { name: ILike(formattedDName) },
          });
          if (existingDistrict) {
            districtId = existingDistrict.id;
          } else {
            const createdDistrict = this.districtRepo.create({ name: formattedDName });
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
          const provName = formatTitleCase(tData.payment_provider_name.trim());
          let existingProv = await this.paymentProviderRepo.findOne({
            where: { name: ILike(provName) },
          });
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
              const bName = formatTitleCase(tData.receiver_bank_name.trim());
              let b = await this.bankRepo.findOne({ where: { name: ILike(bName) } });
              if (!b) {
                b = await this.bankRepo.save(this.bankRepo.create({ name: bName }));
              }
              receiverBankId = b.id;
            }

            const rawRecFullName =
              typeof tData.receiver_card_full_name === 'string'
                ? tData.receiver_card_full_name
                : typeof tData.receiver_full_name === 'string'
                  ? tData.receiver_full_name
                  : null;
            const recFullName = rawRecFullName ? formatUzbekName(rawRecFullName) : null;

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
    crime_method_id?: string | null;
    card_id?: string | null;
    transfer_id?: string | null;
    status_id?: string | null;
    status?: string | null;
    source_id?: string | null;
    department_service_id?: string | null;
    rejection_reason_id?: string | null;
    decision_type_id?: string | null;
  }> {
    let citizenId = dto.citizen_id || null;
    let districtId = dto.district_id || null;
    let crimeId = dto.crime_id || null;
    let crimeMethodId = dto.crime_method_id !== undefined ? dto.crime_method_id : null;
    let cardId = dto.card_id || null;
    let transferId = dto.transfer_id || null;
    let sourceId = dto.source_id !== undefined ? dto.source_id : null;
    let departmentServiceId =
      dto.department_service_id !== undefined ? dto.department_service_id : null;
    let rejectionReasonId = dto.rejection_reason_id !== undefined ? dto.rejection_reason_id : null;
    let decisionTypeId = dto.decision_type_id !== undefined ? dto.decision_type_id : null;

    // 0. Agar bu mavjud arizani tahrirlash bo'lsa (applicationId bor), lekin dto da ID lar kelmagan bo'lsa,
    // arizaning mavjud bog'langan ID larini bazadan olamiz (fuqaroni yo'qotib qo'ymaslik uchun):
    if (applicationId) {
      const existingApp = await this.applicationRepo.findOne({
        where: { id: applicationId },
        select: {
          id: true,
          citizen_id: true,
          district_id: true,
          crime_id: true,
          crime_method_id: true,
          card_id: true,
          transfer_id: true,
          source_id: true,
          department_service_id: true,
          rejection_reason_id: true,
          decision_type_id: true,
        },
      });
      if (existingApp) {
        if (!citizenId && existingApp.citizen_id) {
          citizenId = existingApp.citizen_id;
        }
        if (!districtId && existingApp.district_id) {
          districtId = existingApp.district_id;
        }
        if (!crimeId && existingApp.crime_id) {
          crimeId = existingApp.crime_id;
        }
        if (
          crimeMethodId === null &&
          existingApp.crime_method_id &&
          dto.crime_method_id === undefined
        ) {
          crimeMethodId = existingApp.crime_method_id;
        }
        if (!cardId && existingApp.card_id) {
          cardId = existingApp.card_id;
        }
        if (!transferId && existingApp.transfer_id) {
          transferId = existingApp.transfer_id;
        }
        if (!sourceId && existingApp.source_id && dto.source_id === undefined) {
          sourceId = existingApp.source_id;
        }
        if (
          !departmentServiceId &&
          existingApp.department_service_id &&
          dto.department_service_id === undefined
        ) {
          departmentServiceId = existingApp.department_service_id;
        }
        if (
          !rejectionReasonId &&
          existingApp.rejection_reason_id &&
          dto.rejection_reason_id === undefined
        ) {
          rejectionReasonId = existingApp.rejection_reason_id;
        }
        if (!decisionTypeId && existingApp.decision_type_id && dto.decision_type_id === undefined) {
          decisionTypeId = existingApp.decision_type_id;
        }
      }
    }

    // 1. Fuqaro (Agar citizen_id berilgan yoki arizadan olingan bo'lsa)
    if (citizenId && dto.citizen_data && Object.keys(dto.citizen_data).length > 0) {
      const data = dto.citizen_data as Record<string, string | null | undefined>;
      const existing = await this.citizenRepo.findOne({ where: { id: citizenId } });
      if (existing) {
        let citDistrictId = data.district_id || null;
        if (!citDistrictId && typeof data.district_name === 'string' && data.district_name.trim()) {
          const dName = data.district_name.trim();
          let d = await this.districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await this.districtRepo.save(
              this.districtRepo.create({ name: formatTitleCase(dName) }),
            );
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
              this.mahallaRepo.create({ name: formatTitleCase(mName), district_id: citDistrictId }),
            );
          }
          citMahallaId = m.id;
        }

        if (citDistrictId !== null || data.district_id !== undefined)
          existing.district_id = citDistrictId;
        if (citMahallaId !== null || data.mahalla_id !== undefined)
          existing.mahalla_id = citMahallaId;
        if (data.address !== undefined) existing.address = data.address || null;
        if (data.birth_date !== undefined) existing.birth_date = data.birth_date || null;
        if (data.gender !== undefined) existing.gender = (data.gender as 'male' | 'female') || null;
        if (data.first_name) existing.first_name = formatUzbekName(data.first_name);
        if (data.last_name) existing.last_name = formatUzbekName(data.last_name);
        if (data.middle_name !== undefined)
          existing.middle_name = data.middle_name ? formatUzbekName(data.middle_name) : null;
        if (data.passport !== undefined)
          existing.passport = data.passport ? data.passport.trim().toUpperCase() : null;
        if (data.pinfl !== undefined) existing.pinfl = data.pinfl ? data.pinfl.trim() : null;
        if (data.phone_number !== undefined)
          existing.phone_number = data.phone_number ? data.phone_number.replace(/\D/g, '') : null;
        if (data.occupation_category_id !== undefined)
          existing.occupation_category_id = data.occupation_category_id || null;
        if (data.occupation_id !== undefined) existing.occupation_id = data.occupation_id || null;
        await this.citizenRepo.save(existing);
      }
    } else if (!citizenId && dto.citizen_data && Object.keys(dto.citizen_data).length > 0) {
      const data = dto.citizen_data as Record<string, string>;
      if (data.first_name || data.passport || data.phone_number || data.pinfl) {
        let existingCitizen: Citizen | null = null;
        if (data.passport && data.passport.trim()) {
          existingCitizen = await this.citizenRepo.findOne({
            where: { passport: data.passport.trim().toUpperCase() },
          });
        }
        if (!existingCitizen && data.pinfl && data.pinfl.trim()) {
          existingCitizen = await this.citizenRepo.findOne({
            where: { pinfl: data.pinfl.trim() },
          });
        }
        const cleanPhone = data.phone_number ? data.phone_number.replace(/\D/g, '') : null;
        if (!existingCitizen && cleanPhone && cleanPhone.length >= 7) {
          existingCitizen = await this.citizenRepo.findOne({
            where: { phone_number: cleanPhone },
          });
        }
        if (!existingCitizen && data.first_name && data.last_name) {
          const fName = formatUzbekName(data.first_name);
          const lName = formatUzbekName(data.last_name);
          const nameMatches = await this.citizenRepo.find({
            where: { first_name: fName, last_name: lName },
          });
          if (nameMatches.length === 1) {
            existingCitizen = nameMatches[0];
          } else if (nameMatches.length > 1 && data.middle_name) {
            const mName = formatUzbekName(data.middle_name);
            const mMatch = nameMatches.find((c) => c.middle_name === mName);
            if (mMatch) existingCitizen = mMatch;
          }
        }

        let citDistrictId = data.district_id || null;
        if (!citDistrictId && typeof data.district_name === 'string' && data.district_name.trim()) {
          const dName = data.district_name.trim();
          let d = await this.districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await this.districtRepo.save(
              this.districtRepo.create({ name: formatTitleCase(dName) }),
            );
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
              this.mahallaRepo.create({ name: formatTitleCase(mName), district_id: citDistrictId }),
            );
          }
          citMahallaId = m.id;
        }

        const fName = data.first_name ? formatUzbekName(data.first_name) : null;
        const lName = data.last_name ? formatUzbekName(data.last_name) : null;
        const mName = data.middle_name ? formatUzbekName(data.middle_name) : null;

        if (existingCitizen) {
          if (citDistrictId !== null || data.district_id !== undefined)
            existingCitizen.district_id = citDistrictId;
          if (citMahallaId !== null || data.mahalla_id !== undefined)
            existingCitizen.mahalla_id = citMahallaId;
          if (data.address !== undefined) existingCitizen.address = data.address || null;
          if (data.birth_date !== undefined) existingCitizen.birth_date = data.birth_date || null;
          if (data.gender !== undefined)
            existingCitizen.gender = (data.gender as 'male' | 'female') || null;
          if (fName) existingCitizen.first_name = fName;
          if (lName) existingCitizen.last_name = lName;
          if (mName !== null && mName !== undefined) existingCitizen.middle_name = mName;
          if (data.passport !== undefined)
            existingCitizen.passport = data.passport ? data.passport.trim().toUpperCase() : null;
          if (data.pinfl !== undefined)
            existingCitizen.pinfl = data.pinfl ? data.pinfl.trim() : null;
          if (data.phone_number !== undefined)
            existingCitizen.phone_number = data.phone_number
              ? data.phone_number.replace(/\D/g, '')
              : null;
          if (data.occupation_category_id !== undefined)
            existingCitizen.occupation_category_id = data.occupation_category_id || null;
          if (data.occupation_id !== undefined)
            existingCitizen.occupation_id = data.occupation_id || null;
          await this.citizenRepo.save(existingCitizen);
          citizenId = existingCitizen.id;
        } else {
          const newCitizen = this.citizenRepo.create({
            ...data,
            first_name: fName,
            last_name: lName,
            middle_name: mName,
            passport: data.passport ? data.passport.trim().toUpperCase() : null,
            pinfl: data.pinfl ? data.pinfl.trim() : null,
            phone_number: data.phone_number ? data.phone_number.replace(/\D/g, '') : null,
            birth_date: data.birth_date || null,
            gender: (data.gender as 'male' | 'female') || null,
            district_id: citDistrictId,
            mahalla_id: citMahallaId,
            occupation_category_id: data.occupation_category_id || null,
            occupation_id: data.occupation_id || null,
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
        const formattedDName = formatTitleCase(dName);
        const existingDistrict = await this.districtRepo.findOne({
          where: { name: ILike(formattedDName) },
        });
        if (existingDistrict) {
          districtId = existingDistrict.id;
        } else {
          const newDistrict = this.districtRepo.create({ name: formattedDName });
          const saved = await this.districtRepo.save(newDistrict);
          districtId = saved.id;
        }
      }
    }

    // 3. Jinoyat turi
    if (!crimeId && dto.crime_data && Object.keys(dto.crime_data).length > 0) {
      const data = dto.crime_data as Record<string, string>;
      const rawCrimeName = (data.article || data.title || '').trim();
      if (rawCrimeName) {
        const crimeName = formatTitleCase(rawCrimeName);
        const existingCrime = await this.crimeRepo.findOne({
          where: [{ article: ILike(crimeName) }, { title: ILike(crimeName) }],
        });
        if (existingCrime) {
          crimeId = existingCrime.id;
        } else {
          const newCrime = this.crimeRepo.create({
            article: crimeName,
            title: data.title ? formatTitleCase(data.title) : crimeName,
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
        const cardFullName = data.full_name ? formatUzbekName(data.full_name) : null;
        const existingCard = await this.cardRepo.findOne({ where: { card_number: cleaned } });
        if (existingCard) {
          if (cardFullName && !existingCard.full_name) {
            existingCard.full_name = cardFullName;
            await this.cardRepo.save(existingCard);
          }
          cardId = existingCard.id;
        } else {
          // Bank ma'lumoti kiritilgan bo'lsa, bankni topamiz yoki yaratamiz
          let bankId = data.bank_id || null;
          if (!bankId && data.bank_name) {
            const bName = formatTitleCase(data.bank_name.trim());
            let existingBank = await this.bankRepo.findOne({ where: { name: ILike(bName) } });
            if (!existingBank) {
              existingBank = await this.bankRepo.save(this.bankRepo.create({ name: bName }));
            }
            bankId = existingBank.id;
          }

          const newCard = this.cardRepo.create({
            card_number: cleaned,
            expire_date: data.expire_date || null,
            full_name: cardFullName,
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
          const provName = formatTitleCase(data.payment_provider_name.trim());
          let existingProv = await this.paymentProviderRepo.findOne({
            where: { name: ILike(provName) },
          });
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
              const bName = formatTitleCase(data.receiver_bank_name.trim());
              let b = await this.bankRepo.findOne({ where: { name: ILike(bName) } });
              if (!b) {
                b = await this.bankRepo.save(this.bankRepo.create({ name: bName }));
              }
              receiverBankId = b.id;
            }

            const rawRecFullName =
              typeof data.receiver_card_full_name === 'string'
                ? data.receiver_card_full_name
                : typeof data.receiver_full_name === 'string'
                  ? data.receiver_full_name
                  : null;
            const recFullName = rawRecFullName ? formatUzbekName(rawRecFullName) : null;

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

    // 6. Ariza statusi (Master Entity)
    let statusId = dto.status_id || null;
    let statusCode = dto.status || null;

    if (statusId) {
      const st = await this.statusRepo.findOne({ where: { id: statusId } });
      if (st) {
        statusId = st.id;
        statusCode = st.code || st.name;
      }
    } else if (dto.status) {
      const st = await this.statusRepo.findOne({
        where: [{ code: dto.status }, { name: ILike(dto.status) }],
      });
      if (st) {
        statusId = st.id;
        statusCode = st.code || st.name;
      } else {
        const newSt = await this.statusRepo.save(
          this.statusRepo.create({
            name: dto.status,
            code: dto.status.toUpperCase().replace(/\s+/g, '_').slice(0, 50),
            color: 'blue',
          }),
        );
        statusId = newSt.id;
        statusCode = newSt.code || newSt.name;
      }
    } else if (!applicationId) {
      const def = await this.statusRepo.findOne({
        where: [{ is_default: true }, { code: 'YANGI' }],
        order: { sort_order: 'ASC' },
      });
      if (def) {
        statusId = def.id;
        statusCode = def.code || def.name;
      }
    }

    return {
      citizen_id: citizenId,
      district_id: districtId,
      crime_id: crimeId,
      crime_method_id: crimeMethodId,
      card_id: cardId,
      transfer_id: transferId,
      status_id: statusId,
      status: statusCode,
      source_id: sourceId,
      department_service_id: departmentServiceId,
      rejection_reason_id: rejectionReasonId,
      decision_type_id: decisionTypeId,
    };
  }

  async create(dto: CreateApplicationDto, currentUser?: JwtAccessPayload): Promise<Application> {
    if (currentUser) {
      if (currentUser.role === Role.BOSS) {
        throw new ForbiddenException(
          "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
        );
      }
    }

    const {
      custom_fields,
      date,
      citizen_data: _citizen_data,
      district_data: _district_data,
      crime_data: _crime_data,
      card_data: _card_data,
      transfer_data: _transfer_data,
      ...applicationData
    } = dto;

    // 1. Ariza raqami ko'rsatilgan bo'lsa tozalab olamiz, aks holda null (auto-generate qilinmaydi)
    const appNumber = applicationData.application_number?.trim() || null;

    const resolved = await this.resolvePrimaryModels(dto);

    // Hududiy xodim (DISTRICT_OFFICER) o'ziga biriktirilgan tuman bo'yicha tekshirish
    let creatorUserId: string | null = null;
    if (currentUser) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      creatorUserId = user?.id || null;

      if (currentUser.role === Role.DISTRICT_OFFICER) {
        const assignedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
        const targetDistrictId = resolved.district_id || dto.district_id;
        if (targetDistrictId && !assignedDistrictIds.includes(targetDistrictId)) {
          throw new ForbiddenException(
            "Siz faqat o'zingizga biriktirilgan tuman(lar) uchun ariza yarata olasiz",
          );
        }
      }
    }

    const application = this.applicationRepo.create({
      ...applicationData,
      ...resolved,
      created_by_id: creatorUserId,
      is_deleted: false,
      application_number: appNumber,
      date: date ? new Date(date) : new Date(),
    });

    const saved = await this.applicationRepo.save(application);

    if (resolved.transfer_id) {
      await this.transferRepo.update(resolved.transfer_id, { application_id: saved.id });
    }

    // 2. Dinamik maydonlar (Custom Fields) ni saqlaymiz
    if (custom_fields && custom_fields.length > 0) {
      const fieldEntities = await this.processCustomFields(custom_fields, saved.id);
      await this.customFieldRepo.save(fieldEntities);
    }

    await this.intelligenceSync.syncApplicationById(saved.id);
    return this.findOne(saved.id);
  }

  async findAll(
    pageOrParams:
      | number
      | {
          page?: number;
          limit?: number;
          search?: string;
          status?: string;
          status_id?: string;
          district_id?: string;
          crime_id?: string;
          crime_method_id?: string;
          application_number?: string;
          citizen_name?: string;
          card_number?: string;
          phone_number?: string;
          description?: string;
          date?: string;
          date_from?: string;
          date_to?: string;
          relations_filter?: string;
        } = 1,
    limitParam = 10,
    searchParam?: string,
    statusParam?: string,
    currentUser?: JwtAccessPayload,
  ): Promise<PaginatedResult<Application>> {
    let page = 1;
    let limit = 10;
    let search: string | undefined;
    let status: string | undefined;
    let status_id: string | undefined;
    let district_id: string | undefined;
    let crime_id: string | undefined;
    let crime_method_id: string | undefined;
    let application_number: string | undefined;
    let citizen_name: string | undefined;
    let card_number: string | undefined;
    let phone_number: string | undefined;
    let description: string | undefined;
    let date: string | undefined;
    let date_from: string | undefined;
    let date_to: string | undefined;
    let relations_filter: string | undefined;

    if (typeof pageOrParams === 'object') {
      page = Number(pageOrParams.page) || 1;
      limit = Number(pageOrParams.limit) || 10;
      search = pageOrParams.search;
      status = pageOrParams.status;
      status_id = pageOrParams.status_id;
      district_id = pageOrParams.district_id;
      crime_id = pageOrParams.crime_id;
      crime_method_id = pageOrParams.crime_method_id;
      application_number = pageOrParams.application_number;
      citizen_name = pageOrParams.citizen_name;
      card_number = pageOrParams.card_number;
      phone_number = pageOrParams.phone_number;
      description = pageOrParams.description;
      date = pageOrParams.date;
      date_from = pageOrParams.date_from;
      date_to = pageOrParams.date_to;
      relations_filter = pageOrParams.relations_filter;
    } else {
      page = Number(pageOrParams) || 1;
      limit = Number(limitParam) || 10;
      search = searchParam;
      status = statusParam;
    }

    const qb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoin('app.application_status', 'application_status')
      .leftJoin('app.citizen', 'citizen')
      .leftJoin('app.district', 'district')
      .leftJoin('app.crime', 'crime')
      .where('app.is_deleted = false');

    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      const assignedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
      if (assignedDistrictIds.length > 0) {
        qb.andWhere('app.district_id IN (:...userDistricts)', {
          userDistricts: assignedDistrictIds,
        });
      } else {
        qb.andWhere('1 = 0');
      }
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      qb.andWhere(
        '(app.application_number ILIKE :q OR app.description ILIKE :q OR app.officer_notes ILIKE :q OR citizen.first_name ILIKE :q OR citizen.last_name ILIKE :q OR citizen.middle_name ILIKE :q OR citizen.phone_number ILIKE :q OR citizen.passport ILIKE :q)',
        { q },
      );
    }

    const stVal = status_id || status;
    if (stVal && stVal.trim()) {
      const val = stVal.trim();
      qb.andWhere(
        '(app.status_id = :stVal OR app.status ILIKE :stVal OR application_status.code ILIKE :stVal OR application_status.name ILIKE :stVal)',
        { stVal: val },
      );
    }

    if (district_id && district_id.trim()) {
      qb.andWhere('app.district_id = :district_id', { district_id: district_id.trim() });
    }

    if (crime_id && crime_id.trim()) {
      qb.andWhere('app.crime_id = :crime_id', { crime_id: crime_id.trim() });
    }

    if (crime_method_id && crime_method_id.trim()) {
      qb.andWhere('app.crime_method_id = :crime_method_id', {
        crime_method_id: crime_method_id.trim(),
      });
    }

    if (application_number && application_number.trim()) {
      qb.andWhere('app.application_number ILIKE :appNum', {
        appNum: `%${application_number.trim()}%`,
      });
    }

    if (citizen_name && citizen_name.trim()) {
      const cName = `%${citizen_name.trim()}%`;
      qb.andWhere(
        "(citizen.first_name ILIKE :cName OR citizen.last_name ILIKE :cName OR citizen.middle_name ILIKE :cName OR CONCAT_WS(' ', citizen.last_name, citizen.first_name, citizen.middle_name) ILIKE :cName)",
        { cName },
      );
    }

    if (card_number && card_number.trim()) {
      const cleanedCard = card_number.replace(/\D/g, '') || card_number.trim();
      const cardQ = `%${cleanedCard}%`;
      qb.andWhere(
        `(
          EXISTS (
            SELECT 1 FROM cards c
            WHERE c.id = app.card_id AND (c.card_number ILIKE :cardQ OR c.masked_number ILIKE :cardQ)
          )
          OR EXISTS (
            SELECT 1 FROM transfers t
            LEFT JOIN cards sc ON sc.id = t.sender_card_id
            LEFT JOIN cards rc ON rc.id = t.receiver_card_id
            WHERE (t.id = app.transfer_id OR t.application_id = app.id)
              AND (sc.card_number ILIKE :cardQ OR sc.masked_number ILIKE :cardQ OR rc.card_number ILIKE :cardQ OR rc.masked_number ILIKE :cardQ)
          )
          OR EXISTS (
            SELECT 1 FROM entity_application_links eal
            INNER JOIN cards ec ON ec.id = eal.entity_id AND eal.entity_type = 'CARD'
            WHERE eal.application_id = app.id AND (ec.card_number ILIKE :cardQ OR ec.masked_number ILIKE :cardQ)
          )
          OR CAST(app.suspect_tree AS text) ILIKE :cardQ
        )`,
        { cardQ },
      );
    }

    if (phone_number && phone_number.trim()) {
      const cleanedPhone = phone_number.replace(/\D/g, '') || phone_number.trim();
      const phoneQ = `%${cleanedPhone}%`;
      qb.andWhere(
        `(
          citizen.phone_number ILIKE :phoneQ
          OR EXISTS (
            SELECT 1 FROM entity_application_links eal
            INNER JOIN phones ph ON ph.id = eal.entity_id AND eal.entity_type = 'PHONE'
            WHERE eal.application_id = app.id AND ph.phone_number ILIKE :phoneQ
          )
          OR CAST(app.suspect_tree AS text) ILIKE :phoneQ
        )`,
        { phoneQ },
      );
    }

    if (description && description.trim()) {
      const desc = `%${description.trim()}%`;
      qb.andWhere('(app.description ILIKE :desc OR app.officer_notes ILIKE :desc)', { desc });
    }

    if (date && date.trim()) {
      const dStr = date.trim();
      qb.andWhere("TO_CHAR(COALESCE(app.date, app.created_at), 'YYYY-MM-DD') = :filterDate", {
        filterDate: dStr,
      });
    }

    if (date_from && date_from.trim()) {
      qb.andWhere('COALESCE(app.date, app.created_at) >= :date_from', {
        date_from: new Date(date_from.trim()),
      });
    }

    if (date_to && date_to.trim()) {
      const dTo = new Date(date_to.trim());
      dTo.setHours(23, 59, 59, 999);
      qb.andWhere('COALESCE(app.date, app.created_at) <= :date_to', { date_to: dTo });
    }

    qb.orderBy('app.created_at', 'DESC');

    const relations = {
      application_status: true,
      documents: true,
      source: true,
      department_service: true,
      rejection_reason: true,
      decision_type: true,
      created_by: true,
      citizen: {
        district: true,
        mahalla: true,
        occupation_category: true,
        occupation: true,
      },
      district: true,
      crime: true,
      crime_method: { fields: true },
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
        citizen: {
          district: true,
          mahalla: true,
          occupation_category: true,
          occupation: true,
        },
        card: { bank: true, citizen: true },
        crime: true,
        district: true,
        transfer: {
          payment_provider: true,
          sender_card: true,
          receiver_card: true,
        },
      },
    };

    if (relations_filter === 'with_relations' || relations_filter === 'fraud_card') {
      const matchedApps = await qb.select('app.id').getMany();
      const allIds = matchedApps.map((a) => a.id);
      if (allIds.length === 0) {
        return {
          items: [],
          meta: {
            total: 0,
            page,
            limit,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        };
      }

      const allItems = await this.applicationRepo.find({
        where: { id: In(allIds) },
        relations,
      });
      allItems.sort((a, b) => allIds.indexOf(a.id) - allIds.indexOf(b.id));
      await this.attachRelationsSummaries(allItems);

      const filtered = allItems.filter((item) => {
        if (relations_filter === 'with_relations') {
          return item.relations_summary && item.relations_summary.total > 0;
        }
        if (relations_filter === 'fraud_card') {
          return item.relations_summary && item.relations_summary.has_fraud_card_link;
        }
        return true;
      });

      const total = filtered.length;
      const skip = (page - 1) * limit;
      const paginatedItems = filtered.slice(skip, skip + limit);
      const totalPages = Math.ceil(total / limit) || 1;

      return {
        items: paginatedItems,
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

    const skip = (page - 1) * limit;
    const [matchedApps, total] = await qb
      .select(['app.id', 'app.created_at'])
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const ids = matchedApps.map((a) => a.id);
    let items: Application[] = [];

    if (ids.length > 0) {
      items = await this.applicationRepo.find({
        where: { id: In(ids) },
        relations,
      });
      items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      await this.attachRelationsSummaries(items);
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

  /**
   * Filterlangan barcha arizalarni Excel (.xlsx) faylga eksport qilish
   */
  async exportToExcel(
    params: {
      search?: string;
      status?: string;
      status_id?: string;
      district_id?: string;
      crime_id?: string;
      crime_method_id?: string;
      application_number?: string;
      citizen_name?: string;
      card_number?: string;
      phone_number?: string;
      description?: string;
      date?: string;
      date_from?: string;
      date_to?: string;
      relations_filter?: string;
    },
    res: Response,
    currentUser?: JwtAccessPayload,
  ): Promise<void> {
    const result = await this.findAll(
      {
        ...params,
        page: 1,
        limit: 10000,
      },
      10000,
      undefined,
      undefined,
      currentUser,
    );

    const workbook = await this.excelService.generateWorkbook(result.items);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const fileName = `Arizalar_Hisoboti_${dateStr}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Tanlangan murojaatlarni CyberControl tizimi import shablonida (murojaat_shablon.xlsx) yuklab olish
   */
  async exportCyberControlTemplate(
    ids: string[],
    res: Response,
    currentUser?: JwtAccessPayload,
  ): Promise<void> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Boolean(id && id.trim()))));
    if (uniqueIds.length === 0) {
      throw new NotFoundException('Eksport uchun kamida bitta murojaat tanlanishi shart');
    }

    let allowedDistrictIds: string[] | null = null;
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      allowedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
    }

    const apps = await this.applicationRepo.find({
      where: {
        id: In(uniqueIds),
        is_deleted: false,
      },
      relations: {
        citizen: {
          district: true,
          mahalla: true,
          occupation_category: true,
          occupation: true,
        },
        district: true,
        crime: true,
        crime_method: true,
        transfer: true,
        custom_fields: {
          citizen: {
            district: true,
            mahalla: true,
            occupation_category: true,
            occupation: true,
          },
          transfer: true,
        },
      },
    });

    const filteredApps =
      allowedDistrictIds !== null
        ? apps.filter((a) => a.district_id && allowedDistrictIds.includes(a.district_id))
        : apps;

    if (filteredApps.length === 0) {
      throw new ForbiddenException(
        'Tanlangan murojaatlarni eksport qilish uchun ruxsat mavjud emas',
      );
    }

    // Foydalanuvchi tanlagan tartibni saqlaymiz
    filteredApps.sort((a, b) => uniqueIds.indexOf(a.id) - uniqueIds.indexOf(b.id));

    // Qo'shimcha application_id orqali bog'langan transferlarni ham yig'amiz
    const appIds = filteredApps.map((a) => a.id);
    const linkedTransfers = await this.transferRepo.find({
      where: { application_id: In(appIds) },
    });
    const extraTransfersMap = new Map<string, Transfer[]>();
    for (const tr of linkedTransfers) {
      if (!tr.application_id) continue;
      const list = extraTransfersMap.get(tr.application_id) ?? [];
      list.push(tr);
      extraTransfersMap.set(tr.application_id, list);
    }

    const workbook = await this.cyberControlExcelService.generateWorkbook(
      filteredApps,
      extraTransfersMap,
    );

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `murojaat_shablon_${dateStr}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Arizaga tegishli barcha kartalar ma'lumotlarini ajratib olish
   */
  private extractCardData(app: Application) {
    const cardIds = new Set<string>();
    const receiverCardIds = new Set<string>();
    const senderCardIds = new Set<string>();
    const cardNumbers = new Set<string>();
    const cardMap = new Map<string, { card: Card; role: 'RECEIVER' | 'SENDER' | 'RELATED' }>();

    const registerCard = (
      card: Card | null | undefined,
      role: 'RECEIVER' | 'SENDER' | 'RELATED',
    ) => {
      if (!card || !card.id) return;
      cardIds.add(card.id);
      if (role === 'RECEIVER') receiverCardIds.add(card.id);
      if (role === 'SENDER') senderCardIds.add(card.id);

      const rawNum = (card.card_number || card.masked_number || '').replace(/\D/g, '');
      if (rawNum.length >= 4) {
        cardNumbers.add(rawNum);
      }

      const existing = cardMap.get(card.id);
      if (!existing || role === 'RECEIVER' || (role === 'SENDER' && existing.role !== 'RECEIVER')) {
        cardMap.set(card.id, { card, role });
      }
    };

    if (app.card) registerCard(app.card, 'RELATED');
    else if (app.card_id) cardIds.add(app.card_id);

    if (app.transfer) {
      if (app.transfer.receiver_card) registerCard(app.transfer.receiver_card, 'RECEIVER');
      else if (app.transfer.receiver_card_id) {
        cardIds.add(app.transfer.receiver_card_id);
        receiverCardIds.add(app.transfer.receiver_card_id);
      }

      if (app.transfer.sender_card) registerCard(app.transfer.sender_card, 'SENDER');
      else if (app.transfer.sender_card_id) {
        cardIds.add(app.transfer.sender_card_id);
        senderCardIds.add(app.transfer.sender_card_id);
      }

      if (app.transfer.card) registerCard(app.transfer.card, 'RELATED');
      else if (app.transfer.card_id) cardIds.add(app.transfer.card_id);

      if (app.transfer.custom_fields) {
        for (const tcf of app.transfer.custom_fields) {
          if (tcf.card) registerCard(tcf.card, 'RELATED');
          else if (tcf.card_id) cardIds.add(tcf.card_id);
        }
      }
    }

    if (app.custom_fields) {
      for (const cf of app.custom_fields) {
        if (cf.card) registerCard(cf.card, 'RELATED');
        else if (cf.card_id) cardIds.add(cf.card_id);

        if (cf.transfer) {
          if (cf.transfer.receiver_card) registerCard(cf.transfer.receiver_card, 'RECEIVER');
          else if (cf.transfer.receiver_card_id) {
            cardIds.add(cf.transfer.receiver_card_id);
            receiverCardIds.add(cf.transfer.receiver_card_id);
          }

          if (cf.transfer.sender_card) registerCard(cf.transfer.sender_card, 'SENDER');
          else if (cf.transfer.sender_card_id) {
            cardIds.add(cf.transfer.sender_card_id);
            senderCardIds.add(cf.transfer.sender_card_id);
          }
        }
      }
    }

    return {
      cardIds: Array.from(cardIds),
      receiverCardIds: Array.from(receiverCardIds),
      senderCardIds: Array.from(senderCardIds),
      cardNumbers: Array.from(cardNumbers),
      cardMap,
    };
  }

  /**
   * Arizaga tegishli barcha fuqarolar ma'lumotlarini ajratib olish
   */
  private extractCitizenData(app: Application) {
    const citizenIds = new Set<string>();
    const pinfls = new Set<string>();
    const passports = new Set<string>();
    const phones = new Set<string>();
    const citizenMap = new Map<string, Citizen>();

    const registerCitizen = (citizen: Citizen | null | undefined) => {
      if (!citizen || !citizen.id) return;
      citizenIds.add(citizen.id);
      citizenMap.set(citizen.id, citizen);

      if (citizen.pinfl && citizen.pinfl.trim().length >= 8) {
        pinfls.add(citizen.pinfl.trim());
      }
      if (citizen.passport && citizen.passport.trim().length >= 5) {
        passports.add(citizen.passport.trim().toUpperCase());
      }
      if (citizen.phone_number) {
        const rawPhone = citizen.phone_number.replace(/\D/g, '');
        if (rawPhone.length >= 7) {
          phones.add(rawPhone);
        }
      }
    };

    if (app.citizen) registerCitizen(app.citizen);
    else if (app.citizen_id) citizenIds.add(app.citizen_id);

    if (app.custom_fields) {
      for (const cf of app.custom_fields) {
        if (cf.citizen) registerCitizen(cf.citizen);
        else if (cf.citizen_id) citizenIds.add(cf.citizen_id);
      }
    }

    if (app.transfer?.custom_fields) {
      for (const tcf of app.transfer.custom_fields) {
        if (tcf.citizen) registerCitizen(tcf.citizen);
        else if (tcf.citizen_id) citizenIds.add(tcf.citizen_id);
      }
    }

    return {
      citizenIds: Array.from(citizenIds),
      pinfls: Array.from(pinfls),
      passports: Array.from(passports),
      phones: Array.from(phones),
      citizenMap,
    };
  }

  /**
   * Arizadagi firibgar / gumonlanuvchi daraxtidan (suspect_tree) barcha identifikator va belgilarni ajratib olish
   */
  private extractSuspectTokens(
    app: Application,
  ): { raw: string; normalized: string; path: string }[] {
    if (!app.suspect_tree || !Array.isArray(app.suspect_tree)) return [];
    const tokens: { raw: string; normalized: string; path: string }[] = [];

    const walk = (nodes: SuspectTreeNode[], currentPath: string) => {
      for (const node of nodes) {
        if (!node) continue;
        const fullPath = currentPath ? `${currentPath} → ${node.label || ''}` : node.label || '';
        if (node.value && typeof node.value === 'string' && node.value.trim().length >= 2) {
          const raw = node.value.trim();
          const cleanUsername = raw.toLowerCase().replace(/^@/, '').trim();
          const cleanPhone = raw.replace(/\D/g, '');
          const normalized = cleanPhone.length >= 7 ? cleanPhone : cleanUsername;
          tokens.push({ raw, normalized, path: fullPath });
        }
        if (node.children && Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children, fullPath);
        } else if (
          !node.value &&
          node.label &&
          typeof node.label === 'string' &&
          node.label.trim().length >= 3
        ) {
          const raw = node.label.trim();
          const cleanUsername = raw.toLowerCase().replace(/^@/, '').trim();
          const cleanPhone = raw.replace(/\D/g, '');
          const normalized = cleanPhone.length >= 7 ? cleanPhone : cleanUsername;
          tokens.push({ raw, normalized, path: fullPath });
        }
      }
    };

    walk(app.suspect_tree, '');
    return tokens;
  }

  /**
   * Bosh sahifa jadvali uchun arizalarga ixcham bog'liqlik xulosalarini hisoblash
   */
  private async attachRelationsSummaries(items: Application[]): Promise<void> {
    if (!items || items.length === 0) return;

    try {
      const allApps = await this.applicationRepo.find({
        relations: {
          citizen: true,
          card: true,
          transfer: {
            receiver_card: true,
            sender_card: true,
            card: true,
            custom_fields: { card: true, citizen: true },
          },
          custom_fields: {
            citizen: true,
            card: true,
            transfer: {
              receiver_card: true,
              sender_card: true,
            },
          },
        },
      });

      // Agar arizada transfer_id bo'lmay, transfer jadvalida application_id biriktirilgan bo'lsa
      const extraTransfers = await this.transferRepo.find({
        relations: {
          payment_provider: true,
          sender_card: { bank: true },
          receiver_card: { bank: true },
          card: { bank: true },
          custom_fields: { card: { bank: true }, citizen: true },
        },
      });
      const transferByAppId = new Map<string, Transfer>();
      for (const t of extraTransfers) {
        if (t.application_id) {
          transferByAppId.set(t.application_id, t);
        }
      }

      for (const a of allApps) {
        if (!a.transfer && transferByAppId.has(a.id)) {
          a.transfer = transferByAppId.get(a.id)!;
        }
      }

      const appExtracts = new Map<
        string,
        { cardData: any; citizenData: any; suspectTokens: any[] }
      >();
      for (const a of allApps) {
        appExtracts.set(a.id, {
          cardData: this.extractCardData(a),
          citizenData: this.extractCitizenData(a),
          suspectTokens: this.extractSuspectTokens(a),
        });
      }

      for (const item of items) {
        if (!item.transfer && transferByAppId.has(item.id)) {
          item.transfer = transferByAppId.get(item.id)!;
        }

        const itemExtract = appExtracts.get(item.id) || {
          cardData: this.extractCardData(item),
          citizenData: this.extractCitizenData(item),
          suspectTokens: this.extractSuspectTokens(item),
        };

        const matchedOtherIds = new Set<string>();
        let cardMatchesCount = 0;
        let citizenMatchesCount = 0;
        let suspectMatchesCount = 0;
        let hasFraudLink = false;

        for (const other of allApps) {
          if (other.id === item.id) continue;
          const otherExtract = appExtracts.get(other.id);
          if (!otherExtract) continue;

          let cardMatched = false;
          let citizenMatched = false;
          let suspectMatched = false;

          // Card match
          for (const [cardId, cardEntry] of itemExtract.cardData.cardMap.entries()) {
            const curNum = (
              cardEntry.card.card_number ||
              cardEntry.card.masked_number ||
              ''
            ).replace(/\D/g, '');
            for (const [othCardId, othEntry] of otherExtract.cardData.cardMap.entries()) {
              const othNum = (
                othEntry.card.card_number ||
                othEntry.card.masked_number ||
                ''
              ).replace(/\D/g, '');
              if (
                othCardId === cardId ||
                (curNum.length >= 8 && othNum.length >= 8 && curNum === othNum)
              ) {
                cardMatched = true;
                if (cardEntry.role === 'RECEIVER' && othEntry.role === 'RECEIVER') {
                  hasFraudLink = true;
                }
                break;
              }
            }
            if (cardMatched) break;
          }

          // Citizen match
          for (const [citId, curCit] of itemExtract.citizenData.citizenMap.entries()) {
            if (otherExtract.citizenData.citizenIds.includes(citId)) {
              citizenMatched = true;
              break;
            }
            for (const othCit of otherExtract.citizenData.citizenMap.values()) {
              if (curCit.pinfl && othCit.pinfl && curCit.pinfl.trim() === othCit.pinfl.trim()) {
                citizenMatched = true;
                break;
              }
              if (
                curCit.passport &&
                othCit.passport &&
                curCit.passport.trim().toUpperCase() === othCit.passport.trim().toUpperCase()
              ) {
                citizenMatched = true;
                break;
              }
              const cP = (curCit.phone_number || '').replace(/\D/g, '');
              const oP = (othCit.phone_number || '').replace(/\D/g, '');
              if (cP.length >= 7 && oP.length >= 7 && cP === oP) {
                citizenMatched = true;
                break;
              }
            }
            if (citizenMatched) break;
          }

          // Suspect Tree match
          for (const curTok of itemExtract.suspectTokens) {
            for (const othTok of otherExtract.suspectTokens) {
              if (
                curTok.normalized.length >= 3 &&
                othTok.normalized.length >= 3 &&
                curTok.normalized === othTok.normalized
              ) {
                suspectMatched = true;
                hasFraudLink = true;
                break;
              }
            }
            if (suspectMatched) break;
          }

          if (cardMatched || citizenMatched || suspectMatched) {
            matchedOtherIds.add(other.id);
            if (cardMatched) cardMatchesCount++;
            if (citizenMatched) citizenMatchesCount++;
            if (suspectMatched) suspectMatchesCount++;
          }
        }

        item.relations_summary = {
          total: matchedOtherIds.size,
          cards: cardMatchesCount,
          citizens: citizenMatchesCount,
          suspects: suspectMatchesCount,
          has_fraud_card_link: hasFraudLink,
        };
      }
    } catch (err) {
      console.error('attachRelationsSummaries xatolik:', err);
    }
  }

  /**
   * Tanlangan arizaning barcha boshqa arizalar bilan bog'liqliklari (Karta va Fuqaro bo'yicha)
   */
  async getRelations(id: string, currentUser?: JwtAccessPayload) {
    const currentApp = await this.findOne(id);

    // Agar arizada transfer_id bo'lmasa, transfer jadvalidan application_id orqali tekshirish
    if (!currentApp.transfer) {
      const tr = await this.transferRepo.findOne({
        where: { application_id: currentApp.id },
        relations: {
          payment_provider: true,
          sender_card: { bank: true },
          receiver_card: { bank: true },
          card: { bank: true },
          custom_fields: { card: { bank: true }, citizen: true },
        },
      });
      if (tr) {
        currentApp.transfer = tr;
      }
    }

    const cardData = this.extractCardData(currentApp);
    const citizenData = this.extractCitizenData(currentApp);

    // Barcha boshqa arizalarni relyatsiyalari bilan yuklash
    const otherApps = await this.applicationRepo.find({
      where: { id: Not(id) },
      relations: {
        application_status: true,
        citizen: { district: true, mahalla: true },
        district: true,
        crime: true,
        crime_method: { fields: true },
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: { bank: true },
          receiver_card: { bank: true },
          card: { bank: true },
          custom_fields: { card: { bank: true }, citizen: true },
        },
        custom_fields: {
          citizen: { district: true, mahalla: true },
          card: { bank: true, citizen: true },
          crime: true,
          district: true,
          transfer: {
            payment_provider: true,
            sender_card: { bank: true },
            receiver_card: { bank: true },
          },
        },
      },
      order: { date: 'DESC', created_at: 'DESC' },
    });

    const extraTransfers = await this.transferRepo.find({
      relations: {
        payment_provider: true,
        sender_card: { bank: true },
        receiver_card: { bank: true },
        card: { bank: true },
        custom_fields: { card: { bank: true }, citizen: true },
      },
    });
    const transferByAppId = new Map<string, Transfer>();
    for (const t of extraTransfers) {
      if (t.application_id) {
        transferByAppId.set(t.application_id, t);
      }
    }

    for (const other of otherApps) {
      if (!other.transfer && transferByAppId.has(other.id)) {
        other.transfer = transferByAppId.get(other.id)!;
      }
    }

    const cardRelationsMap = new Map<
      string,
      {
        card: any;
        role_in_current_app: 'RECEIVER' | 'SENDER' | 'RELATED';
        linked_applications: any[];
      }
    >();

    const citizenRelationsMap = new Map<
      string,
      {
        citizen: any;
        match_reasons: Set<string>;
        linked_applications: any[];
      }
    >();

    const suspectRelationsMap = new Map<
      string,
      {
        field_path: string;
        value: string;
        matched_with: string;
        linked_applications: any[];
      }
    >();

    const linkedApplicationIds = new Set<string>();
    let hasFraudCardLink = false;

    // Har bir boshqa arizani tekshirish
    for (const other of otherApps) {
      const otherCardData = this.extractCardData(other);
      const otherCitizenData = this.extractCitizenData(other);

      let isLinked = false;

      // 1. KARTALAR BO'YICHA TEKSHIRUV
      for (const [cardId, currentCardEntry] of cardData.cardMap.entries()) {
        const currentCard = currentCardEntry.card;
        const currentNum = (currentCard.card_number || currentCard.masked_number || '').replace(
          /\D/g,
          '',
        );

        let otherRole: 'RECEIVER' | 'SENDER' | 'RELATED' | null = null;

        for (const [otherCardId, otherEntry] of otherCardData.cardMap.entries()) {
          const otherNum = (
            otherEntry.card.card_number ||
            otherEntry.card.masked_number ||
            ''
          ).replace(/\D/g, '');
          if (
            otherCardId === cardId ||
            (currentNum.length >= 8 && otherNum.length >= 8 && currentNum === otherNum)
          ) {
            otherRole = otherEntry.role;
            break;
          }
        }

        if (otherRole) {
          isLinked = true;
          if (currentCardEntry.role === 'RECEIVER' && otherRole === 'RECEIVER') {
            hasFraudCardLink = true;
          }

          if (!cardRelationsMap.has(cardId)) {
            cardRelationsMap.set(cardId, {
              card: {
                id: currentCard.id,
                card_number: currentCard.card_number,
                masked_number: currentCard.masked_number,
                full_name: currentCard.full_name,
                bank_name: currentCard.bank?.name || null,
              },
              role_in_current_app: currentCardEntry.role,
              linked_applications: [],
            });
          }

          const cardRel = cardRelationsMap.get(cardId)!;
          if (!cardRel.linked_applications.some((a) => a.id === other.id)) {
            cardRel.linked_applications.push({
              id: other.id,
              application_number: other.application_number || 'Raqamsiz',
              status: other.status,
              status_label: other.application_status?.name || other.status || 'Yangi',
              status_color: other.application_status?.color || 'blue',
              date: other.date,
              citizen_name: other.citizen
                ? `${other.citizen.last_name || ''} ${other.citizen.first_name || ''} ${other.citizen.middle_name || ''}`.trim()
                : 'Arizachi kiritilmagan',
              citizen_phone: other.citizen?.phone_number || null,
              role_in_that_app: otherRole,
              transfer_amount: other.transfer?.amount ? Number(other.transfer.amount) : null,
              currency: other.transfer?.currency || 'UZS',
              payment_provider: other.transfer?.payment_provider?.name || null,
              description: other.description || null,
            });
          }
        }
      }

      // 2. FUQAROLAR BO'YICHA TEKSHIRUV
      for (const [citizenId, currentCitizen] of citizenData.citizenMap.entries()) {
        const reasons = new Set<string>();

        if (otherCitizenData.citizenIds.includes(citizenId)) {
          reasons.add('Ayni bir fuqaro profili biriktirilgan');
        }

        for (const otherCitizen of otherCitizenData.citizenMap.values()) {
          if (
            currentCitizen.pinfl &&
            otherCitizen.pinfl &&
            currentCitizen.pinfl.trim() === otherCitizen.pinfl.trim()
          ) {
            reasons.add(`Bir xil JSHSHIR (PINFL): ${currentCitizen.pinfl.trim()}`);
          }

          if (
            currentCitizen.passport &&
            otherCitizen.passport &&
            currentCitizen.passport.trim().toUpperCase() ===
              otherCitizen.passport.trim().toUpperCase()
          ) {
            reasons.add(`Bir xil Pasport: ${currentCitizen.passport.trim().toUpperCase()}`);
          }

          const curPhone = (currentCitizen.phone_number || '').replace(/\D/g, '');
          const othPhone = (otherCitizen.phone_number || '').replace(/\D/g, '');
          if (curPhone.length >= 7 && othPhone.length >= 7 && curPhone === othPhone) {
            reasons.add(`Bir xil Telefon raqami: +${curPhone}`);
          }
        }

        if (reasons.size > 0) {
          isLinked = true;
          if (!citizenRelationsMap.has(citizenId)) {
            citizenRelationsMap.set(citizenId, {
              citizen: {
                id: currentCitizen.id,
                first_name: currentCitizen.first_name,
                last_name: currentCitizen.last_name,
                middle_name: currentCitizen.middle_name,
                phone_number: currentCitizen.phone_number,
                passport: currentCitizen.passport,
                pinfl: currentCitizen.pinfl,
              },
              match_reasons: new Set(),
              linked_applications: [],
            });
          }

          const citRel = citizenRelationsMap.get(citizenId)!;
          reasons.forEach((r) => citRel.match_reasons.add(r));

          if (!citRel.linked_applications.some((a) => a.id === other.id)) {
            citRel.linked_applications.push({
              id: other.id,
              application_number: other.application_number || 'Raqamsiz',
              status: other.status,
              status_label: other.application_status?.name || other.status || 'Yangi',
              status_color: other.application_status?.color || 'blue',
              date: other.date,
              citizen_name: other.citizen
                ? `${other.citizen.last_name || ''} ${other.citizen.first_name || ''} ${other.citizen.middle_name || ''}`.trim()
                : 'Arizachi kiritilmagan',
              transfer_amount: other.transfer?.amount ? Number(other.transfer.amount) : null,
              currency: other.transfer?.currency || 'UZS',
              description: other.description || null,
            });
          }
        }
      }

      // 3. FIRIBGAR / GUMONLANUVCHI DARAXTI (SUSPECT TREE) BO'YICHA TEKSHIRUV
      const currentSuspectTokens = this.extractSuspectTokens(currentApp);
      const otherSuspectTokens = this.extractSuspectTokens(other);
      for (const curTok of currentSuspectTokens) {
        for (const othTok of otherSuspectTokens) {
          if (
            curTok.normalized.length >= 3 &&
            othTok.normalized.length >= 3 &&
            curTok.normalized === othTok.normalized
          ) {
            isLinked = true;
            hasFraudCardLink = true;

            const suspectKey = `${curTok.path}:${curTok.normalized}`;
            if (!suspectRelationsMap.has(suspectKey)) {
              suspectRelationsMap.set(suspectKey, {
                field_path: curTok.path,
                value: curTok.raw,
                matched_with: othTok.raw,
                linked_applications: [],
              });
            }

            const sRel = suspectRelationsMap.get(suspectKey)!;
            if (!sRel.linked_applications.some((a) => a.id === other.id)) {
              sRel.linked_applications.push({
                id: other.id,
                application_number: other.application_number || 'Raqamsiz',
                status: other.status,
                status_label: other.application_status?.name || other.status || 'Yangi',
                status_color: other.application_status?.color || 'blue',
                date: other.date,
                citizen_name: other.citizen
                  ? `${other.citizen.last_name || ''} ${other.citizen.first_name || ''}`.trim()
                  : 'Arizachi kiritilmagan',
                transfer_amount: other.transfer?.amount ? Number(other.transfer.amount) : null,
                currency: other.transfer?.currency || 'UZS',
                description: other.description || null,
              });
            }
          }
        }
      }

      if (isLinked) {
        linkedApplicationIds.add(other.id);
      }
    }

    const cardRelations = Array.from(cardRelationsMap.values());
    const citizenRelations = Array.from(citizenRelationsMap.values()).map((cr) => ({
      ...cr,
      match_reasons: Array.from(cr.match_reasons),
    }));

    let totalLinkedLoss = 0;
    const countedAppIds = new Set<string>();
    for (const cr of cardRelations) {
      for (const la of cr.linked_applications) {
        if (!countedAppIds.has(la.id) && la.transfer_amount) {
          totalLinkedLoss += la.transfer_amount;
          countedAppIds.add(la.id);
        }
      }
    }
    for (const citR of citizenRelations) {
      for (const la of citR.linked_applications) {
        if (!countedAppIds.has(la.id) && la.transfer_amount) {
          totalLinkedLoss += la.transfer_amount;
          countedAppIds.add(la.id);
        }
      }
    }

    const currentAppLoss = currentApp.transfer?.amount ? Number(currentApp.transfer.amount) : 0;

    // =========================================================================
    // 3. GRAPH CANVAS UCHUN TUGUNLAR (NODES) VA QIRRALAR (EDGES) SHAKLLANTIRISH
    // =========================================================================
    const graphNodesMap = new Map<string, any>();
    const graphEdges: any[] = [];

    const ensureCardNode = (
      card: Card | null | undefined,
      defaultRole: 'MULE_DROPPER' | 'TRANSIT' | 'VICTIM_SOURCE',
      appContext?: Application,
    ) => {
      if (!card || !card.id) return null;
      if (!graphNodesMap.has(card.id)) {
        const cleanNum = (card.card_number || card.masked_number || '').replace(/\D/g, '');
        const masked =
          cleanNum.length === 16
            ? `${cleanNum.slice(0, 4)} **** **** ${cleanNum.slice(12, 16)}`
            : card.masked_number || card.card_number || 'Noma‘lum';

        const bankName = card.bank?.name || this.identifyBank(card.card_number);
        const owner = card.citizen
          ? `${card.citizen.last_name || ''} ${card.citizen.first_name || ''}`.trim()
          : card.full_name || 'Karta egasi ko‘rsatilmagan';

        graphNodesMap.set(card.id, {
          id: card.id,
          cardNumber: card.card_number || masked,
          maskedCard: masked,
          bankName,
          totalIn: 0,
          totalOut: 0,
          netFlow: 0,
          inDegree: 0,
          outDegree: 0,
          reportsCount: 0,
          reportIds: [],
          riskScore: defaultRole === 'MULE_DROPPER' ? 85 : defaultRole === 'TRANSIT' ? 50 : 15,
          role: defaultRole,
          isBlacklisted: false,
          ownerName: owner,
          pinfl: card.citizen?.pinfl || '',
          passport: card.citizen?.passport || '',
          phone: card.citizen?.phone_number || '',
          linkedApplications: [],
        });
      }

      const node = graphNodesMap.get(card.id)!;
      if (defaultRole === 'MULE_DROPPER') {
        node.role = 'MULE_DROPPER';
        node.riskScore = Math.max(node.riskScore, 85);
      } else if (defaultRole === 'TRANSIT' && node.role !== 'MULE_DROPPER') {
        node.role = 'TRANSIT';
        node.riskScore = Math.max(node.riskScore, 50);
      }

      if (appContext && !node.reportIds.includes(appContext.id)) {
        node.reportIds.push(appContext.id);
        node.reportsCount = node.reportIds.length;

        node.linkedApplications.push({
          id: appContext.id,
          application_number: appContext.application_number || 'Raqamsiz',
          status: appContext.status,
          status_label: appContext.application_status?.name || appContext.status || 'Yangi',
          status_color: appContext.application_status?.color || 'blue',
          date: appContext.date,
          citizen_name: appContext.citizen
            ? `${appContext.citizen.last_name || ''} ${appContext.citizen.first_name || ''}`.trim()
            : 'Arizachi kiritilmagan',
          citizen_phone: appContext.citizen?.phone_number || null,
          role_in_that_app: defaultRole,
          transfer_amount: appContext.transfer?.amount ? Number(appContext.transfer.amount) : null,
          currency: appContext.transfer?.currency || 'UZS',
          payment_provider: appContext.transfer?.payment_provider?.name || null,
          description: appContext.description || null,
        });
      }

      return node;
    };

    const allRelevantApps = [
      currentApp,
      ...otherApps.filter((o) => linkedApplicationIds.has(o.id)),
    ];

    for (const appItem of allRelevantApps) {
      const tr = appItem.transfer;
      if (!tr) continue;

      const amt = tr.amount ? Number(tr.amount) : 0;
      const providerName = tr.payment_provider?.name || 'To‘lov tizimi';

      let srcNodeId: string | null = null;
      let tgtNodeId: string | null = null;

      if (tr.sender_card) {
        const sNode = ensureCardNode(tr.sender_card, 'VICTIM_SOURCE', appItem);
        if (sNode) {
          sNode.totalOut += amt;
          sNode.outDegree += 1;
          srcNodeId = sNode.id;
        }
      } else if (appItem.citizen) {
        const citNodeId = `cit__${appItem.citizen.id}`;
        if (!graphNodesMap.has(citNodeId)) {
          graphNodesMap.set(citNodeId, {
            id: citNodeId,
            cardNumber:
              `${appItem.citizen.last_name || ''} ${appItem.citizen.first_name || ''}`.trim() ||
              'Arizachi',
            maskedCard:
              `${appItem.citizen.last_name || ''} ${appItem.citizen.first_name || ''}`.trim() ||
              'Arizachi',
            bankName: `Ariza № ${appItem.application_number || 'Raqamsiz'}`,
            totalIn: 0,
            totalOut: amt,
            netFlow: -amt,
            inDegree: 0,
            outDegree: 1,
            reportsCount: 1,
            reportIds: [appItem.id],
            riskScore: 10,
            role: 'VICTIM_SOURCE',
            isBlacklisted: false,
            ownerName:
              `${appItem.citizen.last_name || ''} ${appItem.citizen.first_name || ''}`.trim(),
            pinfl: appItem.citizen.pinfl || '',
            passport: appItem.citizen.passport || '',
            phone: appItem.citizen.phone_number || '',
            linkedApplications: [
              {
                id: appItem.id,
                application_number: appItem.application_number || 'Raqamsiz',
                status: appItem.status,
                status_label: appItem.application_status?.name || appItem.status || 'Yangi',
                status_color: appItem.application_status?.color || 'blue',
                date: appItem.date,
                citizen_name:
                  `${appItem.citizen.last_name || ''} ${appItem.citizen.first_name || ''}`.trim(),
                citizen_phone: appItem.citizen?.phone_number || null,
                role_in_that_app: 'VICTIM_SOURCE',
                transfer_amount: amt,
                currency: tr.currency || 'UZS',
                payment_provider: providerName,
                description: appItem.description || null,
              },
            ],
          });
        }
        const cNode = graphNodesMap.get(citNodeId)!;
        cNode.totalOut += amt;
        srcNodeId = citNodeId;
      }

      if (tr.receiver_card) {
        const rNode = ensureCardNode(tr.receiver_card, 'MULE_DROPPER', appItem);
        if (rNode) {
          rNode.totalIn += amt;
          rNode.inDegree += 1;
          tgtNodeId = rNode.id;
        }
      } else {
        const unkNodeId = `unk__${appItem.id}`;
        if (!graphNodesMap.has(unkNodeId)) {
          graphNodesMap.set(unkNodeId, {
            id: unkNodeId,
            cardNumber: '❓ Noaniq qabul qiluvchi',
            maskedCard: '❓ Noaniq qabul qiluvchi',
            bankName: 'Noma‘lum manzil',
            totalIn: amt,
            totalOut: 0,
            netFlow: amt,
            inDegree: 1,
            outDegree: 0,
            reportsCount: 1,
            reportIds: [appItem.id],
            riskScore: 60,
            role: 'MULE_DROPPER',
            isBlacklisted: false,
            isUnknownDestination: true,
            linkedApplications: [
              {
                id: appItem.id,
                application_number: appItem.application_number || 'Raqamsiz',
                status: appItem.status,
                status_label: appItem.application_status?.name || appItem.status || 'Yangi',
                status_color: appItem.application_status?.color || 'blue',
                date: appItem.date,
                citizen_name: appItem.citizen
                  ? `${appItem.citizen.last_name || ''} ${appItem.citizen.first_name || ''}`.trim()
                  : 'Arizachi',
                citizen_phone: appItem.citizen?.phone_number || null,
                role_in_that_app: 'MULE_DROPPER',
                transfer_amount: amt,
                currency: tr.currency || 'UZS',
                payment_provider: providerName,
                description: appItem.description || null,
              },
            ],
          });
        }
        tgtNodeId = unkNodeId;
      }

      if (srcNodeId && tgtNodeId) {
        graphEdges.push({
          id: `edge__${tr.id || appItem.id}__${srcNodeId}__${tgtNodeId}`,
          from: srcNodeId,
          to: tgtNodeId,
          amount: amt,
          paymentProvider: providerName,
          transactionsCount: 1,
          lastDate:
            tr.transfer_date ||
            (appItem.date ? new Date(appItem.date).toISOString() : new Date().toISOString()),
          applicationNumber: appItem.application_number || 'Raqamsiz',
          applicationId: appItem.id,
          isUnknownDestination: graphNodesMap.get(tgtNodeId)?.isUnknownDestination || false,
        });
      }
    }

    for (const node of graphNodesMap.values()) {
      node.netFlow = node.totalIn - node.totalOut;
      if (node.inDegree > 0 && node.outDegree > 0 && node.role !== 'MULE_DROPPER') {
        node.role = 'TRANSIT';
        node.riskScore = 55;
      }
    }

    const graphNodes = Array.from(graphNodesMap.values());
    const totalFlowAmount = graphEdges.reduce((acc, e) => acc + (e.amount || 0), 0);
    const droppersCount = graphNodes.filter((n) => n.role === 'MULE_DROPPER').length;
    const transitCount = graphNodes.filter((n) => n.role === 'TRANSIT').length;

    const graphSummary = {
      totalCards: graphNodes.length,
      totalFlowAmount,
      droppersCount,
      transitCount,
      blacklistedCount: 0,
    };

    const enhanced = await this.intelligenceService.getEnhancedApplicationIntelligence(
      currentApp.id,
      currentUser,
    );

    return {
      application: {
        id: currentApp.id,
        application_number: currentApp.application_number || 'Raqamsiz',
        description: currentApp.description,
        status: currentApp.status,
        application_status: currentApp.application_status,
        date: currentApp.date,
        citizen: currentApp.citizen,
        transfer: currentApp.transfer,
      },
      stats: {
        total_linked_applications: linkedApplicationIds.size + enhanced.multi_hop_chains.length,
        total_linked_loss: totalLinkedLoss,
        current_app_loss: currentAppLoss,
        grand_total_loss: currentAppLoss + totalLinkedLoss,
        total_cards_count: cardRelations.length,
        total_citizens_count: citizenRelations.length,
        total_suspects_count: Math.max(suspectRelationsMap.size, enhanced.clue_relations.length),
        total_multi_hop_count: enhanced.multi_hop_chains.length,
        has_fraud_card_link: hasFraudCardLink,
      },
      card_relations: cardRelations,
      citizen_relations: citizenRelations,
      suspect_relations: Array.from(suspectRelationsMap.values()),
      clue_relations: enhanced.clue_relations,
      multi_hop_chains: enhanced.multi_hop_chains,
      network_graph: enhanced.network_graph,
      graph: {
        nodes: graphNodes,
        edges: graphEdges,
        summary: graphSummary,
      },
    };
  }

  public identifyBank(cardNumber?: string | null): string {
    if (!cardNumber) return 'Noma‘lum Bank';
    const clean = cardNumber.replace(/\D/g, '');
    const p4 = clean.substring(0, 4);
    const p6 = clean.substring(0, 6);

    if (p4 === '8600') return 'Uzcard';
    if (p4 === '9860') return 'Humo';
    if (p4 === '5614') return 'Uzcard Cobadged';
    if (p6 === '400845') return 'Xalq Banki (Visa)';
    if (p6 === '415865') return 'Kapitalbank (Visa)';
    if (p6 === '416973') return 'Ipak Yo‘li Banki (Visa)';
    if (p6 === '427209') return 'Hamkorbank (Visa)';
    if (p4.startsWith('4')) return 'Visa';
    if (p4.startsWith('5')) return 'Mastercard';
    if (p4.startsWith('62')) return 'UnionPay';
    return 'Bank';
  }

  async findOne(id: string, currentUser?: JwtAccessPayload): Promise<Application> {
    const application = await this.applicationRepo.findOne({
      where: { id },
      relations: {
        application_status: true,
        documents: true,
        source: true,
        department_service: true,
        rejection_reason: true,
        decision_type: true,
        created_by: true,
        citizen: {
          district: true,
          mahalla: true,
          occupation_category: true,
          occupation: true,
        },
        district: true,
        crime: true,
        crime_method: { fields: true },
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
          citizen: {
            district: true,
            mahalla: true,
            occupation_category: true,
            occupation: true,
          },
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

    // IDOR himoyasi: Tuman xodimi faqat o'ziga biriktirilgan tuman(lar) arizasini ko'ra oladi
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      const assignedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
      if (application.district_id && !assignedDistrictIds.includes(application.district_id)) {
        throw new ForbiddenException(
          "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalarini ko'rishingiz mumkin",
        );
      }
    }

    return application;
  }

  async update(
    id: string,
    dto: UpdateApplicationDto,
    currentUser?: JwtAccessPayload,
  ): Promise<Application> {
    const application = await this.findOne(id);

    if (currentUser) {
      if (currentUser.role === Role.BOSS) {
        throw new ForbiddenException(
          "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
        );
      }
      if (currentUser.role === Role.DISTRICT_OFFICER) {
        const user = await this.userRepo.findOne({
          where: { auth_id: currentUser.sub },
          relations: { assigned_districts: true },
        });
        const assignedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
        if (application.district_id && !assignedDistrictIds.includes(application.district_id)) {
          throw new ForbiddenException(
            "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalarini tahrirlashingiz mumkin",
          );
        }
      }
    }

    const {
      custom_fields,
      date,
      citizen_data: _citizen_data,
      district_data: _district_data,
      crime_data: _crime_data,
      card_data: _card_data,
      transfer_data: _transfer_data,
      ...applicationData
    } = dto;

    const resolved = await this.resolvePrimaryModels(dto, id);

    // Stale loaded relation ob'ektlarini olib tashlaymiz, aks holda TypeORM in-memory eskilarini qayta yozib yuboradi:
    delete (application as unknown as Record<string, unknown>).citizen;
    delete (application as unknown as Record<string, unknown>).district;
    delete (application as unknown as Record<string, unknown>).crime;
    delete (application as unknown as Record<string, unknown>).crime_method;
    delete (application as unknown as Record<string, unknown>).card;
    delete (application as unknown as Record<string, unknown>).transfer;
    delete (application as unknown as Record<string, unknown>).application_status;
    delete (application as unknown as Record<string, unknown>).source;
    delete (application as unknown as Record<string, unknown>).department_service;
    delete (application as unknown as Record<string, unknown>).rejection_reason;
    delete (application as unknown as Record<string, unknown>).decision_type;

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

    await this.intelligenceSync.syncApplicationById(id);
    return this.findOne(id);
  }

  async remove(
    id: string,
    currentUser?: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    const application = await this.findOne(id);

    if (currentUser) {
      if (currentUser.role === Role.BOSS) {
        throw new ForbiddenException(
          "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
        );
      }

      if (currentUser.role !== Role.SUPER_ADMIN && currentUser.role !== Role.ADMIN) {
        const user = await this.userRepo.findOne({ where: { auth_id: currentUser.sub } });
        const currentUserId = user?.id;
        if (application.created_by_id && application.created_by_id !== currentUserId) {
          throw new ForbiddenException("Faqat o'zingiz yaratgan arizani o'chira olasiz");
        }
        application.is_deleted = true;
        application.deleted_at = new Date();
        application.deleted_by_id = currentUser.sub;
        await this.applicationRepo.save(application);
        await this.intelligenceSync.syncApplicationById(id);
        return { success: true, message: "Ariza arxivlandi (o'chirildi)" };
      }
    }

    application.is_deleted = true;
    application.deleted_at = new Date();
    application.deleted_by_id = currentUser?.sub || null;
    await this.applicationRepo.save(application);
    await this.intelligenceSync.syncApplicationById(id);
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
      .leftJoinAndSelect('app.application_status', 'application_status')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .leftJoinAndSelect('citizen.mahalla', 'citizen_mahalla')
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
    const mahallaMap = new Map<
      string,
      {
        id: string;
        name: string;
        district_id: string;
        district_name: string | null;
        count: number;
        totalLoss: number;
      }
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

      if (app.citizen?.mahalla) {
        const mKey = app.citizen.mahalla.id;
        const m = mahallaMap.get(mKey) || {
          id: app.citizen.mahalla.id,
          name: app.citizen.mahalla.name,
          district_id: app.citizen.mahalla.district_id,
          district_name: app.district?.name || null,
          count: 0,
          totalLoss: 0,
        };
        m.count++;
        m.totalLoss += amount;
        mahallaMap.set(mKey, m);
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

    // 6. byDistrict (barcha 16 ta tuman kiritilgan holda)
    const allDbDistricts = await this.districtRepo.find({ order: { name: 'ASC' } });
    for (const d of allDbDistricts) {
      if (!districtMap.has(d.id)) {
        districtMap.set(d.id, {
          id: d.id,
          name: d.name || 'Noma‘lum tuman',
          count: 0,
          totalLoss: 0,
        });
      }
    }

    const byDistrict = Array.from(districtMap.values())
      .sort((a, b) => b.count - a.count)
      .map((d) => ({
        ...d,
        percent: totalApplications > 0 ? Math.round((d.count / totalApplications) * 100) : 0,
      }));

    // byMahalla
    const byMahalla = Array.from(mahallaMap.values())
      .sort((a, b) => b.count - a.count)
      .map((m) => ({
        ...m,
        percent: totalApplications > 0 ? Math.round((m.count / totalApplications) * 100) : 0,
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
      byMahalla,
      byCrime,
      byPaymentProvider,
      recentApplications,
    };
  }
}
