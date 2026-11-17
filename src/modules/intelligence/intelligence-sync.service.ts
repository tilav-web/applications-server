import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Application } from '../applications/application.entity';
import { Citizen } from '../applications/citizens/citizen.entity';
import { Bank } from '../applications/transfers/banks/bank.entity';
import { Card } from '../applications/transfers/cards/card.entity';
import { Transfer } from '../applications/transfers/transfer.entity';
import { DigitalIdentifierEntity } from './entities/digital-identifier.entity';
import { EntityApplicationLink, EntityLinkRole } from './entities/entity-application-link.entity';
import { PhoneEntity } from './entities/phone.entity';
import {
  detectMobileOperator,
  formatPhoneDisplay,
  getIdentifierTypeLabel,
  normalizeIdentifierValue,
  normalizePhoneDigits,
} from './utils/identifier-normalizer.util';

interface NormalizedSuspectRow {
  field_key: string;
  field_label: string;
  value: string;
  note?: string;
}

@Injectable()
export class IntelligenceSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IntelligenceSyncService.name);

  constructor(
    @InjectRepository(PhoneEntity)
    private readonly phoneRepo: Repository<PhoneEntity>,
    @InjectRepository(DigitalIdentifierEntity)
    private readonly identifierRepo: Repository<DigitalIdentifierEntity>,
    @InjectRepository(EntityApplicationLink)
    private readonly linkRepo: Repository<EntityApplicationLink>,
    @InjectRepository(Citizen)
    private readonly citizenRepo: Repository<Citizen>,
    @InjectRepository(Card)
    private readonly cardRepo: Repository<Card>,
    @InjectRepository(Bank)
    private readonly bankRepo: Repository<Bank>,
    @InjectRepository(Application)
    private readonly appRepo: Repository<Application>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncAllExistingData();
    } catch (err) {
      this.logger.warn(`Bootstrap intelligence sync ogohlantirish: ${(err as Error)?.message}`);
    }
  }

  /**
   * Tizimdagi barcha mavjud Fuqaro va Arizalarni master jadvallarga dublikatsiz sinxronlash
   */
  async syncAllExistingData(): Promise<{
    syncedCitizens: number;
    syncedApplications: number;
  }> {
    const citizens = await this.citizenRepo.find();
    for (const cit of citizens) {
      await this.syncCitizenEntity(cit);
    }

    const apps = await this.appRepo.find({
      where: { is_deleted: false },
      select: { id: true },
    });

    for (const a of apps) {
      await this.syncApplicationById(a.id);
    }

    this.logger.log(
      `Intelligence Sync yakunlandi: ${citizens.length} ta fuqaro, ${apps.length} ta ariza indekslandi.`,
    );

    return {
      syncedCitizens: citizens.length,
      syncedApplications: apps.length,
    };
  }

  /**
   * Telefon raqamini master 'phones' jadvalida topish yoki yaratish (dublikatsiz)
   */
  async upsertPhone(
    rawPhone: string,
    opts?: {
      citizenId?: string | null;
      isPrimary?: boolean;
      label?: string | null;
      notes?: string | null;
    },
  ): Promise<PhoneEntity | null> {
    const clean = normalizePhoneDigits(rawPhone);
    if (clean.length < 7) return null;

    let phone = await this.phoneRepo.findOne({ where: { phone_number: clean } });
    if (!phone) {
      phone = this.phoneRepo.create({
        phone_number: clean,
        formatted_number: formatPhoneDisplay(clean),
        operator: detectMobileOperator(clean),
        citizen_id: opts?.citizenId || null,
        is_primary: opts?.isPrimary ?? false,
        label: opts?.label || null,
        notes: opts?.notes || null,
      });
      return this.phoneRepo.save(phone);
    }

    let changed = false;
    if (opts?.citizenId && !phone.citizen_id) {
      phone.citizen_id = opts.citizenId;
      changed = true;
    }
    if (opts?.isPrimary && phone.citizen_id === opts.citizenId && !phone.is_primary) {
      phone.is_primary = true;
      changed = true;
    }
    if (opts?.label && !phone.label) {
      phone.label = opts.label;
      changed = true;
    }
    if (opts?.notes && !phone.notes) {
      phone.notes = opts.notes;
      changed = true;
    }
    if (!phone.operator) {
      phone.operator = detectMobileOperator(clean);
      changed = true;
    }

    if (changed) {
      phone = await this.phoneRepo.save(phone);
    }
    return phone;
  }

  /**
   * Raqamli identifikatorni (Telegram, IP, Kripto, IMEI va h.k.) master jadvalda topish yoki yaratish
   */
  async upsertDigitalIdentifier(
    type: string,
    rawValue: string,
    opts?: {
      typeLabel?: string | null;
      citizenId?: string | null;
      notes?: string | null;
    },
  ): Promise<DigitalIdentifierEntity | null> {
    const cleanType = (type || 'other_info').trim().toLowerCase();
    const normalized = normalizeIdentifierValue(cleanType, rawValue);
    if (!normalized || normalized.length < 2) return null;

    let ident = await this.identifierRepo.findOne({
      where: { type: cleanType, normalized_value: normalized },
    });

    if (!ident) {
      ident = this.identifierRepo.create({
        type: cleanType,
        type_label: getIdentifierTypeLabel(cleanType, opts?.typeLabel),
        raw_value: rawValue.trim(),
        normalized_value: normalized,
        citizen_id: opts?.citizenId || null,
        notes: opts?.notes || null,
      });
      return this.identifierRepo.save(ident);
    }

    let changed = false;
    if (opts?.citizenId && !ident.citizen_id) {
      ident.citizen_id = opts.citizenId;
      changed = true;
    }
    if (opts?.notes && !ident.notes) {
      ident.notes = opts.notes;
      changed = true;
    }
    if (changed) {
      ident = await this.identifierRepo.save(ident);
    }
    return ident;
  }

  /**
   * Kartani master 'cards' jadvalida topish yoki yaratish
   */
  async upsertCard(
    rawCardNumber: string,
    opts?: {
      citizenId?: string | null;
      fullName?: string | null;
      expireDate?: string | null;
      bankId?: string | null;
    },
  ): Promise<Card | null> {
    const clean = (rawCardNumber || '').replace(/\D/g, '');
    if (clean.length < 8) return null;

    let card = await this.cardRepo.findOne({ where: { card_number: clean } });
    if (!card) {
      card = this.cardRepo.create({
        card_number: clean,
        citizen_id: opts?.citizenId || null,
        full_name: opts?.fullName || null,
        expire_date: opts?.expireDate || null,
        bank_id: opts?.bankId || null,
      });
      return this.cardRepo.save(card);
    }

    let changed = false;
    if (opts?.citizenId && !card.citizen_id) {
      card.citizen_id = opts.citizenId;
      changed = true;
    }
    if (opts?.fullName && !card.full_name) {
      card.full_name = opts.fullName;
      changed = true;
    }
    if (opts?.expireDate && !card.expire_date) {
      card.expire_date = opts.expireDate;
      changed = true;
    }
    if (opts?.bankId && !card.bank_id) {
      card.bank_id = opts.bankId;
      changed = true;
    }
    if (changed) {
      card = await this.cardRepo.save(card);
    }
    return card;
  }

  async syncCitizenById(citizenId: string): Promise<void> {
    const citizen = await this.citizenRepo.findOne({ where: { id: citizenId } });
    if (citizen) {
      await this.syncCitizenEntity(citizen);
    }
  }

  async syncCitizenEntity(citizen: Citizen): Promise<void> {
    if (citizen.phone_number) {
      await this.upsertPhone(citizen.phone_number, {
        citizenId: citizen.id,
        isPrimary: true,
        label: 'Asosiy telefon raqami',
      });
    }
  }

  private extractSuspectRows(suspectTree: unknown): NormalizedSuspectRow[] {
    if (!suspectTree || !Array.isArray(suspectTree)) return [];
    const rows: NormalizedSuspectRow[] = [];

    for (const item of suspectTree) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;

      if (obj.field_key !== undefined || (obj.value !== undefined && !obj.children)) {
        const val = typeof obj.value === 'string' ? obj.value.trim() : '';
        if (val) {
          rows.push({
            field_key: typeof obj.field_key === 'string' ? obj.field_key : 'other_info',
            field_label:
              typeof obj.field_label === 'string'
                ? obj.field_label
                : typeof obj.label === 'string'
                  ? obj.label
                  : 'Gumonlanuvchi belgisi',
            value: val,
            note: typeof obj.note === 'string' ? obj.note : undefined,
          });
        }
      } else if (Array.isArray(obj.children)) {
        const walk = (nodes: unknown[], path: string[] = []) => {
          for (const n of nodes) {
            if (!n || typeof n !== 'object') continue;
            const nodeObj = n as Record<string, unknown>;
            const rawText =
              typeof nodeObj.label === 'string'
                ? nodeObj.label
                : typeof nodeObj.value === 'string'
                  ? nodeObj.value
                  : '';
            const text = rawText.trim();
            const nextPath = text ? [...path, text] : path;
            if (Array.isArray(nodeObj.children) && nodeObj.children.length > 0) {
              walk(nodeObj.children, nextPath);
            } else if (text) {
              const pathStr = nextPath.join(' ').toLowerCase();
              let inferredKey = 'other_info';
              if (pathStr.includes('telegram') && pathStr.includes('id'))
                inferredKey = 'telegram_id';
              else if (pathStr.includes('telegram') || text.startsWith('@'))
                inferredKey = 'telegram_username';
              else if (pathStr.includes('telefon') || pathStr.includes('phone'))
                inferredKey = 'phone_number';
              else if (pathStr.includes('karta') || pathStr.includes('card'))
                inferredKey = 'card_number';
              else if (pathStr.includes('instagram')) inferredKey = 'instagram_username';
              else if (pathStr.includes('ip')) inferredKey = 'ip_address';
              else if (pathStr.includes('kripto') || pathStr.includes('wallet'))
                inferredKey = 'crypto_wallet';

              rows.push({
                field_key: inferredKey,
                field_label: path[0] || 'Gumonlanuvchi',
                value: text,
                note: nextPath.join(' ➔ '),
              });
            }
          }
        };
        walk([obj]);
      }
    }

    return rows;
  }

  private inferCustomFieldRole(label?: string | null): EntityLinkRole {
    const l = (label || '').toLowerCase();
    if (l.includes('gumon') || l.includes('firibgar') || l.includes('aybdor')) return 'SUSPECT';
    if (l.includes('dropper') || l.includes('qabul qiluvchi')) return 'DROPPER';
    if (l.includes('tranzit') || l.includes('vositachi')) return 'TRANSIT';
    if (l.includes('guvoh')) return 'WITNESS';
    if (l.includes('jabrlanuvchi') || l.includes('arizachi')) return 'VICTIM';
    return 'RELATED';
  }

  /**
   * Arizaning barcha bog'langan ob'ektlarini 'entity_application_links' va master jadvallarga sinxronlash
   */
  async syncApplicationById(applicationId: string): Promise<void> {
    const app = await this.appRepo.findOne({
      where: { id: applicationId },
      relations: {
        citizen: true,
        card: true,
        transfer: {
          sender_card: true,
          receiver_card: true,
          card: true,
          custom_fields: { card: true, citizen: true },
        },
        custom_fields: {
          citizen: true,
          card: true,
          transfer: {
            sender_card: true,
            receiver_card: true,
          },
        },
      },
    });

    if (!app) return;

    if (app.is_deleted) {
      await this.linkRepo.delete({ application_id: app.id });
      return;
    }

    // Faqat AUTO_SYNC yozuvlarni yangilaymiz; xodim qo'lda biriktirgan MANUAL_OFFICER / CONFIRMED_MATCH saqlanib qoladi
    await this.linkRepo.delete({
      application_id: app.id,
      source: 'AUTO_SYNC',
    });

    const newLinks: EntityApplicationLink[] = [];
    const seenKeys = new Set<string>();

    const pushLink = (partial: {
      citizen_id?: string | null;
      card_id?: string | null;
      phone_id?: string | null;
      identifier_id?: string | null;
      role: EntityLinkRole;
      note?: string | null;
    }) => {
      const key = `${partial.citizen_id || ''}|${partial.card_id || ''}|${partial.phone_id || ''}|${partial.identifier_id || ''}|${partial.role}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      newLinks.push(
        this.linkRepo.create({
          application_id: app.id,
          citizen_id: partial.citizen_id || null,
          card_id: partial.card_id || null,
          phone_id: partial.phone_id || null,
          identifier_id: partial.identifier_id || null,
          role: partial.role,
          source: 'AUTO_SYNC',
          note: partial.note || null,
        }),
      );
    };

    // 1. Asosiy Jabrlanuvchi Fuqaro va uning telefoni
    if (app.citizen) {
      await this.syncCitizenEntity(app.citizen);
      pushLink({
        citizen_id: app.citizen.id,
        role: 'VICTIM',
        note: 'Asosiy arizachi / jabrlanuvchi',
      });

      if (app.citizen.phone_number) {
        const ph = await this.upsertPhone(app.citizen.phone_number, {
          citizenId: app.citizen.id,
          isPrimary: true,
        });
        if (ph) {
          pushLink({
            phone_id: ph.id,
            citizen_id: app.citizen.id,
            role: 'VICTIM',
            note: 'Jabrlanuvchi telefon raqami',
          });
        }
      }
    }

    // 2. Asosiy Karta
    if (app.card) {
      pushLink({
        card_id: app.card.id,
        citizen_id: app.card.citizen_id || app.citizen_id || null,
        role: 'VICTIM',
        note: 'Jabrlanuvchi plastik kartasi',
      });
    }

    // 3. Asosiy va bog'langan O'tkazmalar
    const appTransfers: Transfer[] = [];
    if (app.transfer) appTransfers.push(app.transfer);

    const extraAppTransfers = await this.transferRepo.find({
      where: { application_id: app.id },
      relations: { sender_card: true, receiver_card: true, card: true },
    });
    for (const et of extraAppTransfers) {
      if (!appTransfers.some((t) => t.id === et.id)) {
        appTransfers.push(et);
      }
    }

    for (const tr of appTransfers) {
      if (tr.sender_card) {
        pushLink({
          card_id: tr.sender_card.id,
          citizen_id: tr.sender_card.citizen_id || null,
          role: 'VICTIM',
          note: 'Pul yechilgan (joʻnatuvchi) karta',
        });
      }
      if (tr.receiver_card) {
        pushLink({
          card_id: tr.receiver_card.id,
          citizen_id: tr.receiver_card.citizen_id || null,
          role: 'DROPPER',
          note: 'Pul tushgan (qabul qiluvchi / dropper) karta',
        });
        if (tr.receiver_card.citizen_id) {
          pushLink({
            citizen_id: tr.receiver_card.citizen_id,
            card_id: tr.receiver_card.id,
            role: 'DROPPER',
            note: 'Qabul qiluvchi karta egasi (Dropper)',
          });
        }
      }
    }

    // 4. Custom Fields
    if (Array.isArray(app.custom_fields)) {
      for (const cf of app.custom_fields) {
        const cfRole = this.inferCustomFieldRole(cf.label);
        if (cf.citizen) {
          await this.syncCitizenEntity(cf.citizen);
          pushLink({
            citizen_id: cf.citizen.id,
            role: cfRole,
            note: cf.label || 'Qoʻshimcha shaxs',
          });
          if (cf.citizen.phone_number) {
            const ph = await this.upsertPhone(cf.citizen.phone_number, {
              citizenId: cf.citizen.id,
            });
            if (ph) {
              pushLink({
                phone_id: ph.id,
                citizen_id: cf.citizen.id,
                role: cfRole,
                note: cf.label || null,
              });
            }
          }
        }
        if (cf.card) {
          pushLink({
            card_id: cf.card.id,
            citizen_id: cf.card.citizen_id || null,
            role: cfRole,
            note: cf.label || 'Qoʻshimcha karta',
          });
        }
        if (cf.transfer) {
          if (cf.transfer.sender_card) {
            pushLink({
              card_id: cf.transfer.sender_card.id,
              citizen_id: cf.transfer.sender_card.citizen_id || null,
              role: 'VICTIM',
              note: cf.label || 'Qoʻshimcha oʻtkazma joʻnatuvchisi',
            });
          }
          if (cf.transfer.receiver_card) {
            pushLink({
              card_id: cf.transfer.receiver_card.id,
              citizen_id: cf.transfer.receiver_card.citizen_id || null,
              role: 'DROPPER',
              note: cf.label || 'Qoʻshimcha oʻtkazma qabul qiluvchisi',
            });
            if (cf.transfer.receiver_card.citizen_id) {
              pushLink({
                citizen_id: cf.transfer.receiver_card.citizen_id,
                card_id: cf.transfer.receiver_card.id,
                role: 'DROPPER',
                note: 'Qoʻshimcha qabul qiluvchi karta egasi',
              });
            }
          }
        }
      }
    }

    // 5. Suspect Tree (Gumonlanuvchi belgilari: Tel, Karta, Telegram, IP, Kripto, IMEI va h.k.)
    const suspectRows = this.extractSuspectRows(app.suspect_tree);
    for (const row of suspectRows) {
      const key = row.field_key.toLowerCase();
      if (key.includes('phone') || key.includes('telefon')) {
        const ph = await this.upsertPhone(row.value, {
          label: 'Gumonlanuvchi raqami',
          notes: row.note || null,
        });
        if (ph) {
          pushLink({
            phone_id: ph.id,
            citizen_id: ph.citizen_id || null,
            role: 'SUSPECT',
            note: row.note || row.field_label || 'Gumonlanuvchi telefoni',
          });
          if (ph.citizen_id) {
            pushLink({
              citizen_id: ph.citizen_id,
              phone_id: ph.id,
              role: 'SUSPECT',
              note: `Gumonlanuvchi telefoni (${ph.formatted_number || ph.phone_number}) egasi`,
            });
          }
        }
      } else if (key.includes('card') || key.includes('karta')) {
        const crd = await this.upsertCard(row.value);
        if (crd) {
          pushLink({
            card_id: crd.id,
            citizen_id: crd.citizen_id || null,
            role: 'SUSPECT',
            note: row.note || row.field_label || 'Gumonlanuvchi kartasi',
          });
          if (crd.citizen_id) {
            pushLink({
              citizen_id: crd.citizen_id,
              card_id: crd.id,
              role: 'SUSPECT',
              note: `Gumonlanuvchi kartasi (${crd.masked_number || crd.card_number}) egasi`,
            });
          }
        }
      } else {
        const ident = await this.upsertDigitalIdentifier(row.field_key, row.value, {
          typeLabel: row.field_label,
          notes: row.note || null,
        });
        if (ident) {
          pushLink({
            identifier_id: ident.id,
            citizen_id: ident.citizen_id || null,
            role: 'SUSPECT',
            note: row.note || row.field_label,
          });
          if (ident.citizen_id) {
            pushLink({
              citizen_id: ident.citizen_id,
              identifier_id: ident.id,
              role: 'SUSPECT',
              note: `${ident.type_label || ident.type}: ${ident.raw_value} egasi`,
            });
          }
        }
      }
    }

    if (newLinks.length > 0) {
      await this.linkRepo.save(newLinks);
    }
  }
}
