import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, ILike, Repository } from 'typeorm';

import { TransferCustomFieldType } from '../../common/enums/transfer-custom-field-type.enum';
import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import { formatTitleCase, formatUzbekName } from '../../common/utils/name-formatter.util';
import {
  normalizeCardNumber,
  normalizeCitizenFullName,
  normalizePassport,
  normalizePinfl,
  normalizeUzPhone,
} from '../../common/utils/normalization.util';
import { DigitalIdentifierEntity } from '../intelligence/entities/digital-identifier.entity';
import {
  getIdentifierTypeLabel,
  normalizeIdentifierValue,
} from '../intelligence/utils/identifier-normalizer.util';
import { Application } from './application.entity';
import { Citizen } from './citizens/citizen.entity';
import { Crime } from './crimes/crime.entity';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { District } from './districts/district.entity';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { UpdateApplicationDto } from './dto/update-application.dto';
import { Neighborhood } from './neighborhoods/neighborhood.entity';
import { ApplicationStatus as ApplicationStatusEntity } from './statuses/application-status.entity';
import { Bank } from './transfers/banks/bank.entity';
import { Card } from './transfers/cards/card.entity';
import { TransferCustomField } from './transfers/custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './transfers/payment_providers/payment_provider.entity';
import { Transfer } from './transfers/transfer.entity';
import { WorkplacesService } from './workplaces/workplaces.service';

export interface ResolvedApplicationModels {
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
  workplace_id?: string | null;
  work_position?: string | null;
}

@Injectable()
export class ApplicationsResolverService {
  constructor(
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    private readonly workplacesService: WorkplacesService,
  ) {}

  private parseTransferAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    }
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/[\s\u00A0\u202F,]/g, '').replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  private async upsertTransferFromInlineData(
    manager: EntityManager,
    tData: Record<string, unknown>,
    opts: {
      existingTransferId: string | null;
      senderCardId: string | null;
      applicationId: string | null;
      defaultCustomFieldType: TransferCustomFieldType;
    },
  ): Promise<string | null> {
    const cardRepo = manager.getRepository(Card);
    const transferRepo = manager.getRepository(Transfer);
    const bankRepo = manager.getRepository(Bank);
    const paymentProviderRepo = manager.getRepository(PaymentProvider);
    const transferCustomFieldRepo = manager.getRepository(TransferCustomField);

    const parsedAmount = this.parseTransferAmount(tData.amount);
    const currency =
      typeof tData.currency === 'string' && tData.currency.trim()
        ? tData.currency.trim().toUpperCase()
        : 'UZS';
    const transferDate =
      typeof tData.transfer_date === 'string' && tData.transfer_date.trim()
        ? tData.transfer_date.trim()
        : null;
    const transferTime =
      typeof tData.transfer_time === 'string' && tData.transfer_time.trim()
        ? tData.transfer_time.trim()
        : null;
    const transactionId =
      typeof tData.transaction_id === 'string' && tData.transaction_id.trim()
        ? tData.transaction_id.trim()
        : null;

    let providerId =
      typeof tData.payment_provider_id === 'string' && tData.payment_provider_id.trim()
        ? tData.payment_provider_id.trim()
        : null;
    if (
      !providerId &&
      typeof tData.payment_provider_name === 'string' &&
      tData.payment_provider_name.trim()
    ) {
      const provName = formatTitleCase(tData.payment_provider_name.trim());
      let existingProv = await paymentProviderRepo.findOne({
        where: { name: ILike(provName) },
      });
      if (!existingProv) {
        existingProv = await paymentProviderRepo.save(
          paymentProviderRepo.create({
            name: provName,
            code: provName.toLowerCase().replace(/\s+/g, '_'),
          }),
        );
      }
      providerId = existingProv.id;
    }

    let receiverCardId =
      typeof tData.receiver_card_id === 'string' && tData.receiver_card_id.trim()
        ? tData.receiver_card_id.trim()
        : null;
    const rawRecFullName =
      typeof tData.receiver_card_full_name === 'string'
        ? tData.receiver_card_full_name
        : typeof tData.receiver_full_name === 'string'
          ? tData.receiver_full_name
          : null;
    const recFullName = rawRecFullName?.trim() ? formatUzbekName(rawRecFullName) : null;

    let receiverBankId =
      typeof tData.receiver_bank_id === 'string' && tData.receiver_bank_id.trim()
        ? tData.receiver_bank_id.trim()
        : null;
    if (
      !receiverBankId &&
      typeof tData.receiver_bank_name === 'string' &&
      tData.receiver_bank_name.trim()
    ) {
      const bName = formatTitleCase(tData.receiver_bank_name.trim());
      let b = await bankRepo.findOne({ where: { name: ILike(bName) } });
      if (!b) {
        b = await bankRepo.save(bankRepo.create({ name: bName }));
      }
      receiverBankId = b.id;
    }

    if (!receiverCardId && typeof tData.receiver_card_number === 'string') {
      const cleanedReceiver = normalizeCardNumber(tData.receiver_card_number);
      if (cleanedReceiver && cleanedReceiver.length >= 8) {
        let existingReceiverCard = await cardRepo.findOne({
          where: { card_number: cleanedReceiver },
        });
        if (!existingReceiverCard) {
          existingReceiverCard = await cardRepo.save(
            cardRepo.create({
              card_number: cleanedReceiver,
              expire_date:
                typeof tData.receiver_card_expire === 'string' ? tData.receiver_card_expire : null,
              full_name: recFullName,
              bank_id: receiverBankId,
            }),
          );
        } else {
          let dirty = false;
          if (recFullName && !existingReceiverCard.full_name) {
            existingReceiverCard.full_name = recFullName;
            dirty = true;
          }
          if (receiverBankId && !existingReceiverCard.bank_id) {
            existingReceiverCard.bank_id = receiverBankId;
            dirty = true;
          }
          if (dirty) {
            await cardRepo.save(existingReceiverCard);
          }
        }
        receiverCardId = existingReceiverCard.id;
      }
    } else if (receiverCardId && (recFullName || receiverBankId)) {
      const existingReceiverCard = await cardRepo.findOne({ where: { id: receiverCardId } });
      if (existingReceiverCard) {
        let dirty = false;
        if (recFullName && !existingReceiverCard.full_name) {
          existingReceiverCard.full_name = recFullName;
          dirty = true;
        }
        if (receiverBankId && !existingReceiverCard.bank_id) {
          existingReceiverCard.bank_id = receiverBankId;
          dirty = true;
        }
        if (dirty) {
          await cardRepo.save(existingReceiverCard);
        }
      }
    }

    const effectiveSenderCardId =
      opts.senderCardId ||
      (typeof tData.sender_card_id === 'string' && tData.sender_card_id.trim()
        ? tData.sender_card_id.trim()
        : null);

    // Chiqish kanali (CARD, CRYPTO, PLATFORM, BANK_ACCOUNT, CASH) va raqamli qabul qiluvchi manzil
    const rawDestType =
      typeof tData.destination_type === 'string' && tData.destination_type.trim()
        ? (tData.destination_type.trim().toUpperCase() as TransferDestinationType)
        : TransferDestinationType.CARD;
    const destinationType: TransferDestinationType = Object.values(
      TransferDestinationType,
    ).includes(rawDestType)
      ? rawDestType
      : TransferDestinationType.CARD;
    const destPlatform =
      typeof tData.destination_platform === 'string' ? tData.destination_platform.trim() : '';
    const destValue =
      typeof tData.destination_value === 'string' ? tData.destination_value.trim() : '';
    const rawDestDetails =
      tData.destination_details && typeof tData.destination_details === 'object'
        ? (tData.destination_details as Record<string, unknown>)
        : {};
    const destinationDetails: Record<string, unknown> | null =
      destPlatform || destValue || Object.keys(rawDestDetails).length > 0
        ? {
            ...rawDestDetails,
            ...(destPlatform ? { platform: destPlatform } : {}),
            ...(destValue ? { value: destValue } : {}),
          }
        : null;
    let destinationLabel =
      typeof tData.destination_label === 'string' && tData.destination_label.trim()
        ? tData.destination_label.trim()
        : null;
    let receiverIdentifierId =
      typeof tData.receiver_identifier_id === 'string' && tData.receiver_identifier_id.trim()
        ? tData.receiver_identifier_id.trim()
        : null;

    if (destinationType !== TransferDestinationType.CARD) {
      receiverCardId = null;
      if (!destinationLabel) {
        if (destPlatform && destValue) destinationLabel = `${destPlatform}: ${destValue}`;
        else if (destValue) destinationLabel = destValue;
        else if (destPlatform) destinationLabel = destPlatform;
      }
      if (
        !receiverIdentifierId &&
        destValue.length >= 2 &&
        destinationType !== TransferDestinationType.CASH
      ) {
        const identRepo = manager.getRepository(DigitalIdentifierEntity);
        const identType =
          destinationType === TransferDestinationType.CRYPTO
            ? 'crypto_wallet'
            : destinationType === TransferDestinationType.BANK_ACCOUNT
              ? 'bank_account'
              : destinationType === TransferDestinationType.PLATFORM
                ? destPlatform
                  ? `platform_${destPlatform.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
                  : 'online_platform'
                : 'cashout_destination';
        const normalized = normalizeIdentifierValue(identType, destValue);
        if (normalized && normalized.length >= 2) {
          let ident = await identRepo.findOne({
            where: { type: identType, normalized_value: normalized },
          });
          if (!ident) {
            ident = await identRepo.save(
              identRepo.create({
                type: identType,
                type_label:
                  destPlatform ||
                  getIdentifierTypeLabel(
                    identType,
                    destinationType === TransferDestinationType.CRYPTO
                      ? 'Kripto-hamyon / Birja'
                      : destinationType === TransferDestinationType.BANK_ACCOUNT
                        ? 'Bank hisob raqami'
                        : 'Onlayn tizim / Profil',
                  ),
                raw_value: destValue,
                normalized_value: normalized,
              }),
            );
          }
          receiverIdentifierId = ident.id;
        }
      }
    }

    // Mavjud transfer bo'lsa (tahrirlash rejimida) — barcha maydonlarni bazada yangilaymiz
    if (opts.existingTransferId) {
      const existingTransfer = await transferRepo.findOne({
        where: { id: opts.existingTransferId },
      });
      if (existingTransfer) {
        existingTransfer.amount = parsedAmount;
        existingTransfer.currency = currency;
        existingTransfer.payment_provider_id = providerId;
        existingTransfer.receiver_card_id = receiverCardId;
        existingTransfer.sender_card_id = effectiveSenderCardId;
        existingTransfer.transfer_date = transferDate;
        existingTransfer.transfer_time = transferTime;
        existingTransfer.destination_type = destinationType;
        existingTransfer.receiver_identifier_id =
          destinationType === TransferDestinationType.CARD ? null : receiverIdentifierId;
        existingTransfer.destination_label =
          destinationType === TransferDestinationType.CARD ? null : destinationLabel;
        existingTransfer.destination_details =
          destinationType === TransferDestinationType.CARD ? null : destinationDetails;
        if (tData.transaction_id !== undefined) {
          existingTransfer.transaction_id = transactionId;
        }
        if (opts.applicationId && !existingTransfer.application_id) {
          existingTransfer.application_id = opts.applicationId;
        }
        await transferRepo.save(existingTransfer);
        return existingTransfer.id;
      }
    }

    const hasMeaningfulTransferData = Boolean(
      parsedAmount !== null ||
      receiverCardId ||
      receiverIdentifierId ||
      destinationLabel ||
      transferDate ||
      transferTime ||
      providerId ||
      transactionId ||
      effectiveSenderCardId,
    );
    if (!hasMeaningfulTransferData) {
      return null;
    }

    const createdTransfer = transferRepo.create({
      transaction_id: transactionId,
      amount: parsedAmount,
      currency,
      payment_provider_id: providerId,
      receiver_card_id: receiverCardId,
      sender_card_id: effectiveSenderCardId,
      application_id: opts.applicationId,
      transfer_date: transferDate,
      transfer_time: transferTime,
      destination_type: destinationType,
      receiver_identifier_id:
        destinationType === TransferDestinationType.CARD ? null : receiverIdentifierId,
      destination_label: destinationType === TransferDestinationType.CARD ? null : destinationLabel,
      destination_details:
        destinationType === TransferDestinationType.CARD ? null : destinationDetails,
    });
    const savedTransfer = await transferRepo.save(createdTransfer);

    const rawTransferFields = Array.isArray(tData.custom_fields)
      ? tData.custom_fields
      : Array.isArray(tData.transfer_custom_fields)
        ? tData.transfer_custom_fields
        : null;
    if (rawTransferFields && rawTransferFields.length > 0) {
      const tFields = rawTransferFields.map((tf: Record<string, unknown>, idx: number) =>
        transferCustomFieldRepo.create({
          transfer_id: savedTransfer.id,
          label: typeof tf.label === 'string' ? tf.label : 'Qo‘shimcha ma‘lumot',
          key: typeof tf.key === 'string' ? tf.key : `field_${idx}`,
          type: (typeof tf.type === 'string'
            ? tf.type
            : opts.defaultCustomFieldType) as TransferCustomFieldType,
          value: tf.value ?? null,
          card_id: typeof tf.card_id === 'string' ? tf.card_id : null,
          citizen_id: typeof tf.citizen_id === 'string' ? tf.citizen_id : null,
          bank_id: typeof tf.bank_id === 'string' ? tf.bank_id : null,
          payment_provider_id:
            typeof tf.payment_provider_id === 'string' ? tf.payment_provider_id : null,
          order: idx,
        }),
      );
      await transferCustomFieldRepo.save(tFields);
    }

    return savedTransfer.id;
  }

  async processCustomFields(
    fields: NonNullable<CreateApplicationDto['custom_fields']>,
    applicationId: string,
    manager: EntityManager = this.applicationRepo.manager,
  ): Promise<ApplicationCustomField[]> {
    const customFieldRepo = manager.getRepository(ApplicationCustomField);
    const citizenRepo = manager.getRepository(Citizen);
    const crimeRepo = manager.getRepository(Crime);
    const districtRepo = manager.getRepository(District);
    const neighborhoodRepo = manager.getRepository(Neighborhood);
    const cardRepo = manager.getRepository(Card);
    const bankRepo = manager.getRepository(Bank);

    const entities: ApplicationCustomField[] = [];

    for (const f of fields) {
      let citizenId = f.citizen_id || null;
      let cardId = f.card_id || null;
      let crimeId = f.crime_id || null;
      let districtId = f.district_id || null;
      let transferId = f.transfer_id || null;

      // 1. Yangi yoki mavjud Fuqaro (inline_citizen — yaratish va tahrirlashda ham saqlanadi)
      if (f.inline_citizen) {
        const cData = f.inline_citizen as Record<string, string | null | undefined>;
        const pNum = normalizeUzPhone(cData.phone_number);
        const pass = normalizePassport(cData.passport);
        const pinfl = normalizePinfl(cData.pinfl);
        const rawFullName = normalizeCitizenFullName(cData);
        const fullName = rawFullName ? formatUzbekName(rawFullName) : null;
        const addr =
          typeof cData.address === 'string' && cData.address.trim() ? cData.address.trim() : null;

        // Tuman va Mahallani aniqlash (Unique Models)
        let citDistrictId = cData.district_id || null;
        if (
          !citDistrictId &&
          typeof cData.district_name === 'string' &&
          cData.district_name.trim()
        ) {
          const dName = cData.district_name.trim();
          let d = await districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await districtRepo.save(districtRepo.create({ name: dName }));
          }
          citDistrictId = d.id;
        }

        let citNeighborhoodId = cData.neighborhood_id || null;
        if (
          !citNeighborhoodId &&
          typeof cData.neighborhood_name === 'string' &&
          cData.neighborhood_name.trim() &&
          citDistrictId
        ) {
          const mNameStr = cData.neighborhood_name.trim();
          let m = await neighborhoodRepo.findOne({
            where: { name: ILike(mNameStr), district_id: citDistrictId },
          });
          if (!m) {
            m = await neighborhoodRepo.save(
              neighborhoodRepo.create({ name: mNameStr, district_id: citDistrictId }),
            );
          }
          citNeighborhoodId = m.id;
        }

        if (citizenId) {
          // Mavjud qo'shimcha fuqaro tahrirlanayotgan bo'lsa — barcha o'zgartirilgan maydonlarni yangilaymiz
          const existingLinked = await citizenRepo.findOne({ where: { id: citizenId } });
          if (existingLinked) {
            if (
              cData.full_name !== undefined ||
              cData.first_name !== undefined ||
              cData.last_name !== undefined ||
              cData.middle_name !== undefined
            ) {
              existingLinked.full_name = fullName;
            }
            if (cData.passport !== undefined) existingLinked.passport = pass;
            if (cData.pinfl !== undefined) existingLinked.pinfl = pinfl;
            if (cData.phone_number !== undefined) existingLinked.phone_number = pNum;
            if (cData.address !== undefined) existingLinked.address = addr;
            if (cData.birth_date !== undefined)
              existingLinked.birth_date = cData.birth_date || null;
            if (cData.gender !== undefined) {
              existingLinked.gender = (cData.gender as 'male' | 'female') || null;
            }
            if (citDistrictId !== null || cData.district_id !== undefined) {
              existingLinked.district_id = citDistrictId;
            }
            if (citNeighborhoodId !== null || cData.neighborhood_id !== undefined) {
              existingLinked.neighborhood_id = citNeighborhoodId;
            }
            await citizenRepo.save(existingLinked);
          }
        } else if (fullName || pass || pinfl || pNum || citDistrictId || citNeighborhoodId) {
          let existingCitizen: Citizen | null = null;
          if (pass) {
            existingCitizen = await citizenRepo.findOne({ where: { passport: pass } });
          }
          if (!existingCitizen && pinfl) {
            existingCitizen = await citizenRepo.findOne({ where: { pinfl } });
          }
          if (!existingCitizen && pNum && fullName) {
            existingCitizen = await citizenRepo.findOne({
              where: { phone_number: pNum, full_name: fullName },
            });
          }

          if (existingCitizen) {
            // Faqat bo'sh maydonlarni to'ldiramiz, mavjud identifikatorlarni qayta yozmaymiz
            if (addr && !existingCitizen.address) existingCitizen.address = addr;
            if (fullName && !existingCitizen.full_name) existingCitizen.full_name = fullName;
            if (cData.birth_date && !existingCitizen.birth_date)
              existingCitizen.birth_date = cData.birth_date;
            if (cData.gender && !existingCitizen.gender)
              existingCitizen.gender = cData.gender as 'male' | 'female';
            if (citDistrictId && !existingCitizen.district_id)
              existingCitizen.district_id = citDistrictId;
            if (citNeighborhoodId && !existingCitizen.neighborhood_id)
              existingCitizen.neighborhood_id = citNeighborhoodId;
            await citizenRepo.save(existingCitizen);
            citizenId = existingCitizen.id;
          } else {
            const createdCitizen = citizenRepo.create({
              full_name: fullName,
              passport: pass,
              pinfl: pinfl,
              phone_number: pNum,
              birth_date: cData.birth_date || null,
              gender: (cData.gender as 'male' | 'female') || null,
              address: addr,
              district_id: citDistrictId,
              neighborhood_id: citNeighborhoodId,
            });
            const savedCitizen = await citizenRepo.save(createdCitizen);
            citizenId = savedCitizen.id;
          }
        }
      }

      // 2. Yangi yoki mavjud Karta (inline_card)
      if (f.inline_card) {
        const cdData = f.inline_card as Record<string, string>;
        const cleaned = normalizeCardNumber(cdData.card_number);
        let bankId = cdData.bank_id || null;
        if (!bankId && cdData.bank_name) {
          const bName = formatTitleCase(cdData.bank_name.trim());
          let existingBank = await bankRepo.findOne({ where: { name: ILike(bName) } });
          if (!existingBank) {
            existingBank = await bankRepo.save(
              bankRepo.create({
                name: bName,
                mfo: cdData.bank_mfo || null,
              }),
            );
          }
          bankId = existingBank.id;
        }
        const cardFullName = cdData.full_name ? formatUzbekName(cdData.full_name) : null;

        if (!cardId && cleaned) {
          const existingCard = await cardRepo.findOne({ where: { card_number: cleaned } });
          if (existingCard) {
            let dirty = false;
            if (cardFullName && !existingCard.full_name) {
              existingCard.full_name = cardFullName;
              dirty = true;
            }
            if (bankId && !existingCard.bank_id) {
              existingCard.bank_id = bankId;
              dirty = true;
            }
            if (dirty) await cardRepo.save(existingCard);
            cardId = existingCard.id;
          } else {
            const createdCard = cardRepo.create({
              card_number: cleaned,
              expire_date: cdData.expire_date || null,
              full_name: cardFullName,
              bank_id: bankId,
              citizen_id: citizenId || cdData.citizen_id || null,
            });
            const savedCard = await cardRepo.save(createdCard);
            cardId = savedCard.id;
          }
        } else if (cardId && (cardFullName || bankId)) {
          const existingCard = await cardRepo.findOne({ where: { id: cardId } });
          if (existingCard) {
            let dirty = false;
            if (cardFullName && !existingCard.full_name) {
              existingCard.full_name = cardFullName;
              dirty = true;
            }
            if (bankId && !existingCard.bank_id) {
              existingCard.bank_id = bankId;
              dirty = true;
            }
            if (dirty) await cardRepo.save(existingCard);
          }
        }
      }

      // 3. Yangi yoki mavjud Jinoyat Moddasi (inline_crime)
      if (f.inline_crime && !crimeId) {
        const crData = f.inline_crime as Record<string, string>;
        if (crData.article) {
          const cArt = formatTitleCase(crData.article.trim());
          const existingCrime = await crimeRepo.findOne({
            where: [{ article: ILike(cArt) }, { title: ILike(cArt) }],
          });
          if (existingCrime) {
            crimeId = existingCrime.id;
          } else {
            const createdCrime = crimeRepo.create({
              article: cArt,
              title: crData.title ? formatTitleCase(crData.title) : cArt,
              category: crData.category || null,
              description: crData.description || null,
            });
            const savedCrime = await crimeRepo.save(createdCrime);
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
          const existingDistrict = await districtRepo.findOne({
            where: { name: ILike(formattedDName) },
          });
          if (existingDistrict) {
            districtId = existingDistrict.id;
          } else {
            const createdDistrict = districtRepo.create({ name: formattedDName });
            const savedDistrict = await districtRepo.save(createdDistrict);
            districtId = savedDistrict.id;
          }
        }
      }

      // 5. Yangi yoki mavjud inline Transfer kiritilgan/tahrirlangan bo'lsa
      if (f.inline_transfer) {
        transferId = await this.upsertTransferFromInlineData(manager, f.inline_transfer, {
          existingTransferId: transferId,
          senderCardId: cardId,
          applicationId,
          defaultCustomFieldType: TransferCustomFieldType.TEXT,
        });
      }

      entities.push(
        customFieldRepo.create({
          application_id: applicationId,
          label: f.label || null,
          key: f.key || null,
          entity_role: f.entity_role || null,
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

  async resolvePrimaryModels(
    dto: CreateApplicationDto | UpdateApplicationDto,
    applicationId?: string,
    manager: EntityManager = this.applicationRepo.manager,
  ): Promise<ResolvedApplicationModels> {
    const applicationRepo = manager.getRepository(Application);
    const citizenRepo = manager.getRepository(Citizen);
    const crimeRepo = manager.getRepository(Crime);
    const districtRepo = manager.getRepository(District);
    const neighborhoodRepo = manager.getRepository(Neighborhood);
    const cardRepo = manager.getRepository(Card);
    const bankRepo = manager.getRepository(Bank);
    const statusRepo = manager.getRepository(ApplicationStatusEntity);

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

    if (applicationId) {
      const existingApp = await applicationRepo.findOne({
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
        if (
          !citizenId &&
          existingApp.citizen_id &&
          dto.citizen_id === undefined &&
          dto.citizen_data === undefined
        ) {
          citizenId = existingApp.citizen_id;
        }
        if (
          !districtId &&
          existingApp.district_id &&
          dto.district_id === undefined &&
          dto.district_data === undefined
        ) {
          districtId = existingApp.district_id;
        }
        if (
          !crimeId &&
          existingApp.crime_id &&
          dto.crime_id === undefined &&
          dto.crime_data === undefined
        ) {
          crimeId = existingApp.crime_id;
        }
        if (
          crimeMethodId === null &&
          existingApp.crime_method_id &&
          dto.crime_method_id === undefined
        ) {
          crimeMethodId = existingApp.crime_method_id;
        }
        const hasNewCardNumber = Boolean(
          dto.card_data &&
          typeof dto.card_data.card_number === 'string' &&
          normalizeCardNumber(dto.card_data.card_number),
        );
        if (!cardId && existingApp.card_id && dto.card_id === undefined && !hasNewCardNumber) {
          cardId = existingApp.card_id;
        }
        if (!transferId && existingApp.transfer_id && dto.transfer_id === undefined) {
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
      const existing = await citizenRepo.findOne({ where: { id: citizenId } });
      if (existing) {
        let citDistrictId = data.district_id || null;
        if (!citDistrictId && typeof data.district_name === 'string' && data.district_name.trim()) {
          const dName = data.district_name.trim();
          let d = await districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await districtRepo.save(districtRepo.create({ name: formatTitleCase(dName) }));
          }
          citDistrictId = d.id;
        }

        let citNeighborhoodId = data.neighborhood_id || null;
        if (
          !citNeighborhoodId &&
          typeof data.neighborhood_name === 'string' &&
          data.neighborhood_name.trim() &&
          citDistrictId
        ) {
          const mName = data.neighborhood_name.trim();
          let m = await neighborhoodRepo.findOne({
            where: { name: ILike(mName), district_id: citDistrictId },
          });
          if (!m) {
            m = await neighborhoodRepo.save(
              neighborhoodRepo.create({ name: formatTitleCase(mName), district_id: citDistrictId }),
            );
          }
          citNeighborhoodId = m.id;
        }

        if (citDistrictId !== null || data.district_id !== undefined)
          existing.district_id = citDistrictId;
        if (citNeighborhoodId !== null || data.neighborhood_id !== undefined)
          existing.neighborhood_id = citNeighborhoodId;
        if (data.address !== undefined) existing.address = data.address || null;
        if (data.birth_date !== undefined) existing.birth_date = data.birth_date || null;
        if (data.gender !== undefined) existing.gender = (data.gender as 'male' | 'female') || null;
        if (
          data.full_name !== undefined ||
          data.first_name !== undefined ||
          data.last_name !== undefined ||
          data.middle_name !== undefined
        ) {
          const merged = normalizeCitizenFullName(data);
          existing.full_name = merged ? formatUzbekName(merged) : null;
        }
        if (data.passport !== undefined) existing.passport = normalizePassport(data.passport);
        if (data.pinfl !== undefined) existing.pinfl = normalizePinfl(data.pinfl);
        if (data.phone_number !== undefined)
          existing.phone_number = normalizeUzPhone(data.phone_number);
        if (data.occupation_category_id !== undefined)
          existing.occupation_category_id = data.occupation_category_id || null;
        if (data.occupation_id !== undefined) existing.occupation_id = data.occupation_id || null;
        await citizenRepo.save(existing);
      }
    } else if (!citizenId && dto.citizen_data && Object.keys(dto.citizen_data).length > 0) {
      const data = dto.citizen_data as Record<string, string>;
      const cleanPassport = normalizePassport(data.passport);
      const cleanPinfl = normalizePinfl(data.pinfl);
      const cleanPhone = normalizeUzPhone(data.phone_number);
      const rawFullName = normalizeCitizenFullName(data);

      if (rawFullName || cleanPassport || cleanPhone || cleanPinfl) {
        // Faqat yagona identifikatorlar (pasport, JSHSHIR, telefon) bo'yicha qidiramiz — ism/familiya bilan birlashtirmaymiz!
        let existingCitizen: Citizen | null = null;
        if (cleanPassport) {
          existingCitizen = await citizenRepo.findOne({ where: { passport: cleanPassport } });
        }
        if (!existingCitizen && cleanPinfl) {
          existingCitizen = await citizenRepo.findOne({ where: { pinfl: cleanPinfl } });
        }
        if (!existingCitizen && cleanPhone && cleanPhone.length >= 7) {
          existingCitizen = await citizenRepo.findOne({ where: { phone_number: cleanPhone } });
        }

        let citDistrictId = data.district_id || null;
        if (!citDistrictId && typeof data.district_name === 'string' && data.district_name.trim()) {
          const dName = data.district_name.trim();
          let d = await districtRepo.findOne({ where: { name: ILike(dName) } });
          if (!d) {
            d = await districtRepo.save(districtRepo.create({ name: formatTitleCase(dName) }));
          }
          citDistrictId = d.id;
        }

        let citNeighborhoodId = data.neighborhood_id || null;
        if (
          !citNeighborhoodId &&
          typeof data.neighborhood_name === 'string' &&
          data.neighborhood_name.trim() &&
          citDistrictId
        ) {
          const mName = data.neighborhood_name.trim();
          let m = await neighborhoodRepo.findOne({
            where: { name: ILike(mName), district_id: citDistrictId },
          });
          if (!m) {
            m = await neighborhoodRepo.save(
              neighborhoodRepo.create({ name: formatTitleCase(mName), district_id: citDistrictId }),
            );
          }
          citNeighborhoodId = m.id;
        }

        const fullName = rawFullName ? formatUzbekName(rawFullName) : null;

        if (existingCitizen) {
          // Avto-biriktirilganda mavjud ma'lumotlarni buzib yubormasdan faqat bo'sh maydonlarni to'ldiramiz
          if (citDistrictId && !existingCitizen.district_id)
            existingCitizen.district_id = citDistrictId;
          if (citNeighborhoodId && !existingCitizen.neighborhood_id)
            existingCitizen.neighborhood_id = citNeighborhoodId;
          if (data.address && !existingCitizen.address) existingCitizen.address = data.address;
          if (data.birth_date && !existingCitizen.birth_date)
            existingCitizen.birth_date = data.birth_date;
          if (data.gender && !existingCitizen.gender)
            existingCitizen.gender = data.gender as 'male' | 'female';
          if (fullName && !existingCitizen.full_name) existingCitizen.full_name = fullName;
          if (cleanPassport && !existingCitizen.passport) existingCitizen.passport = cleanPassport;
          if (cleanPinfl && !existingCitizen.pinfl) existingCitizen.pinfl = cleanPinfl;
          if (cleanPhone && !existingCitizen.phone_number)
            existingCitizen.phone_number = cleanPhone;
          if (data.occupation_category_id && !existingCitizen.occupation_category_id)
            existingCitizen.occupation_category_id = data.occupation_category_id;
          if (data.occupation_id && !existingCitizen.occupation_id)
            existingCitizen.occupation_id = data.occupation_id;
          await citizenRepo.save(existingCitizen);
          citizenId = existingCitizen.id;
        } else {
          // Whitelist: mass-assignment (`...data`) ishlatilmaydi
          const newCitizen = citizenRepo.create({
            full_name: fullName,
            passport: cleanPassport,
            pinfl: cleanPinfl,
            phone_number: cleanPhone,
            birth_date: data.birth_date || null,
            gender: (data.gender as 'male' | 'female') || null,
            address: data.address ? data.address.trim() : null,
            district_id: citDistrictId,
            neighborhood_id: citNeighborhoodId,
            occupation_category_id: data.occupation_category_id || null,
            occupation_id: data.occupation_id || null,
          });
          const saved = await citizenRepo.save(newCitizen);
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
        const existingDistrict = await districtRepo.findOne({
          where: { name: ILike(formattedDName) },
        });
        if (existingDistrict) {
          districtId = existingDistrict.id;
        } else {
          const newDistrict = districtRepo.create({ name: formattedDName });
          const saved = await districtRepo.save(newDistrict);
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
        const existingCrime = await crimeRepo.findOne({
          where: [{ article: ILike(crimeName) }, { title: ILike(crimeName) }],
        });
        if (existingCrime) {
          crimeId = existingCrime.id;
        } else {
          const newCrime = crimeRepo.create({
            article: crimeName,
            title: data.title ? formatTitleCase(data.title) : crimeName,
          });
          const saved = await crimeRepo.save(newCrime);
          crimeId = saved.id;
        }
      }
    }

    // 4. Plastik karta (Asosiy / Jabrlanuvchi kartasi)
    if (dto.card_data && Object.keys(dto.card_data).length > 0) {
      const data = dto.card_data as Record<string, string>;
      const cleaned = normalizeCardNumber(data.card_number);
      const cardFullName = data.full_name ? formatUzbekName(data.full_name) : null;

      let bankId = data.bank_id || null;
      if (!bankId && data.bank_name) {
        const bName = formatTitleCase(data.bank_name.trim());
        let existingBank = await bankRepo.findOne({ where: { name: ILike(bName) } });
        if (!existingBank) {
          existingBank = await bankRepo.save(bankRepo.create({ name: bName }));
        }
        bankId = existingBank.id;
      }

      if (!cardId && cleaned) {
        const existingCard = await cardRepo.findOne({ where: { card_number: cleaned } });
        if (existingCard) {
          let dirty = false;
          if (cardFullName && !existingCard.full_name) {
            existingCard.full_name = cardFullName;
            dirty = true;
          }
          if (bankId && !existingCard.bank_id) {
            existingCard.bank_id = bankId;
            dirty = true;
          }
          if (dirty) {
            await cardRepo.save(existingCard);
          }
          cardId = existingCard.id;
        } else {
          const newCard = cardRepo.create({
            card_number: cleaned,
            expire_date: data.expire_date || null,
            full_name: cardFullName,
            bank_id: bankId,
            citizen_id: citizenId || data.citizen_id || null,
          });
          const saved = await cardRepo.save(newCard);
          cardId = saved.id;
        }
      } else if (cardId && (cardFullName || bankId)) {
        const existingCard = await cardRepo.findOne({ where: { id: cardId } });
        if (existingCard) {
          let dirty = false;
          if (cardFullName && !existingCard.full_name) {
            existingCard.full_name = cardFullName;
            dirty = true;
          }
          if (bankId && !existingCard.bank_id) {
            existingCard.bank_id = bankId;
            dirty = true;
          }
          if (dirty) {
            await cardRepo.save(existingCard);
          }
        }
      }
    }

    // 5. To'lov o'tkazmasi (Transfer) — yaratish va tahrirlashda ham to'liq yangilanadi
    if (dto.transfer_data && Object.keys(dto.transfer_data).length > 0) {
      transferId = await this.upsertTransferFromInlineData(manager, dto.transfer_data, {
        existingTransferId: transferId,
        senderCardId: cardId,
        applicationId: applicationId || null,
        defaultCustomFieldType: TransferCustomFieldType.STRING,
      });
    } else if (transferId && cardId) {
      const transferRepo = manager.getRepository(Transfer);
      const existingTransfer = await transferRepo.findOne({
        where: { id: transferId },
        select: { id: true, sender_card_id: true },
      });
      if (existingTransfer && existingTransfer.sender_card_id !== cardId) {
        await transferRepo.update(transferId, { sender_card_id: cardId });
      }
    }

    // 6. Ariza statusi (Master Entity — noma'lum status stringidan avto-yaratish taqiqlangan!)
    let statusId = dto.status_id || null;
    let statusCode = dto.status || null;

    if (statusId) {
      const st = await statusRepo.findOne({ where: { id: statusId } });
      if (!st) {
        throw new BadRequestException(`Tanlangan ariza statusi (ID: ${statusId}) topilmadi`);
      }
      statusId = st.id;
      statusCode = st.code || st.name;
    } else if (dto.status && dto.status.trim()) {
      const cleanStatus = dto.status.trim();
      const st = await statusRepo.findOne({
        where: [{ code: ILike(cleanStatus) }, { name: ILike(cleanStatus) }],
      });
      if (!st) {
        throw new BadRequestException(
          `«${cleanStatus}» ariza statusi ma'lumotnomada mavjud emas. Avval ma'lumotnomalar bo'limidan status yarating.`,
        );
      }
      statusId = st.id;
      statusCode = st.code || st.name;
    } else if (!applicationId) {
      const def = await statusRepo.findOne({
        where: [{ is_default: true }, { code: 'YANGI' }],
        order: { sort_order: 'ASC' },
      });
      if (def) {
        statusId = def.id;
        statusCode = def.code || def.name;
      }
    }

    // Ish joyi / Tashkilot (workplaces master modeli) ni hal qilish (findOrCreate)
    let workplaceId: string | null | undefined = dto.workplace_id;
    if (!workplaceId && dto.workplace_data) {
      const wpData = dto.workplace_data as Record<string, string | null | undefined>;
      if (wpData.name && wpData.name.trim()) {
        const wp = await this.workplacesService.findOrCreate({
          name: wpData.name,
          district_id: wpData.district_id || null,
          neighborhood_id: wpData.neighborhood_id || null,
          occupation_category_id: wpData.occupation_category_id || null,
          address: wpData.address || null,
          inn: wpData.inn || null,
        });
        workplaceId = wp.id;
      }
    }

    const workPosition =
      dto.work_position !== undefined ? dto.work_position?.trim() || null : undefined;

    if (citizenId && (workplaceId !== undefined || workPosition !== undefined)) {
      const citizenPatch: { workplace_id?: string | null; work_position?: string | null } = {};
      if (workplaceId !== undefined) citizenPatch.workplace_id = workplaceId || null;
      if (workPosition !== undefined) citizenPatch.work_position = workPosition;
      if (Object.keys(citizenPatch).length > 0) {
        await citizenRepo.update(citizenId, citizenPatch);
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
      ...(workplaceId !== undefined ? { workplace_id: workplaceId || null } : {}),
      ...(workPosition !== undefined ? { work_position: workPosition } : {}),
    };
  }
}
