import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ApplicationRepeatType } from '../../common/enums/appeal-classification.enum';
import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../common/utils/district-scope.util';
import { IntelligenceService } from '../intelligence/intelligence.service';
import {
  isCardLikeFieldKey,
  isLinkableIdentifierType,
  isPhoneLikeFieldKey,
  normalizeIdentifierValue,
  normalizePhoneDigits,
} from '../intelligence/utils/identifier-normalizer.util';
import { User } from '../users/user.entity';
import { Application, SuspectTreeNode } from './application.entity';
import { shouldIncludeInDamageTotal } from './application-chain.util';
import { Citizen } from './citizens/citizen.entity';
import { Card } from './transfers/cards/card.entity';
import { Transfer } from './transfers/transfer.entity';

export interface LinkedApplicationSummary {
  id: string;
  application_number: string;
  status: string | null;
  status_label: string;
  status_color: string;
  date: Date | null;
  district_name?: string | null;
  crime_article?: string | null;
  citizen_name: string;
  citizen_phone?: string | null;
  role_in_that_app?: string;
  transfer_amount: number | null;
  currency: string;
  payment_provider?: string | null;
  description: string | null;
  is_cross_role?: boolean;
}

export interface RelationMatchReason {
  kind: 'CARD' | 'PHONE' | 'IDENTIFIER' | 'CITIZEN' | 'CROSS_ROLE' | 'MULTI_HOP';
  label: string;
  value: string;
  danger: boolean;
}

export interface UnifiedLinkedApplication extends LinkedApplicationSummary {
  match_reasons: RelationMatchReason[];
  is_cross_role: boolean;
  has_fraud_match: boolean;
}

export interface CardRelationSummary {
  id: string;
  card_number: string | null;
  masked_number: string | null;
  full_name: string | null;
  bank_name: string | null;
  citizen_id?: string | null;
  citizen_name?: string | null;
}

export interface CitizenRelationSummary {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  passport: string | null;
  pinfl: string | null;
}

export interface RelationGraphNode {
  id: string;
  cardNumber: string;
  maskedCard: string;
  bankName: string;
  totalIn: number;
  totalOut: number;
  netFlow: number;
  inDegree: number;
  outDegree: number;
  reportsCount: number;
  reportIds: string[];
  riskScore: number;
  role:
    | 'MULE_DROPPER'
    | 'TRANSIT'
    | 'VICTIM_SOURCE'
    | 'ATM_TERMINAL'
    | 'CRYPTO_CASHOUT'
    | 'PLATFORM_CASHOUT'
    | 'BANK_ACCOUNT_OUT';
  isBlacklisted: boolean;
  isUnknownDestination?: boolean;
  destinationType?: string;
  identifierId?: string;
  ownerName?: string;
  pinfl?: string;
  passport?: string;
  phone?: string;
  linkedApplications: LinkedApplicationSummary[];
}

export interface RelationGraphEdge {
  id: string;
  from: string;
  to: string;
  amount: number;
  paymentProvider: string;
  transactionsCount: number;
  lastDate: string;
  applicationNumber: string;
  applicationId: string;
  isUnknownDestination: boolean;
}

type CardAppRole = 'RECEIVER' | 'SUSPECT' | 'TRANSIT' | 'SENDER' | 'RELATED';
type CitizenAppRole = 'SUSPECT' | 'DROPPER' | 'TRANSIT' | 'VICTIM' | 'WITNESS' | 'RELATED';

const FRAUD_CARD_ROLES: ReadonlySet<CardAppRole> = new Set(['RECEIVER', 'SUSPECT', 'TRANSIT']);
const FRAUD_CITIZEN_ROLES: ReadonlySet<CitizenAppRole> = new Set(['SUSPECT', 'DROPPER', 'TRANSIT']);
const VALID_ENTITY_ROLES: ReadonlySet<string> = new Set([
  'VICTIM',
  'SUSPECT',
  'DROPPER',
  'TRANSIT',
  'WITNESS',
  'RELATED',
]);

function isFraudCardRole(role: CardAppRole): boolean {
  return FRAUD_CARD_ROLES.has(role);
}

function isFraudCitizenRole(role: CitizenAppRole): boolean {
  return FRAUD_CITIZEN_ROLES.has(role);
}

function inferCustomFieldRole(label?: string | null, explicitRole?: string | null): CitizenAppRole {
  const cleanExplicit = (explicitRole || '').trim().toUpperCase();
  if (cleanExplicit && VALID_ENTITY_ROLES.has(cleanExplicit)) {
    return cleanExplicit as CitizenAppRole;
  }
  const l = (label || '').toLowerCase();
  if (
    l.includes('gumon') ||
    l.includes('firibgar') ||
    l.includes('aybdor') ||
    l.includes('sherik') ||
    l.includes('shubha') ||
    l.includes('гумон') ||
    l.includes('фирибгар') ||
    l.includes('айбдор') ||
    l.includes('шерик') ||
    l.includes('шубҳа') ||
    l.includes('suspect')
  ) {
    return 'SUSPECT';
  }
  if (
    l.includes('dropper') ||
    l.includes('qabul qiluvchi') ||
    l.includes('karta egasi') ||
    l.includes('дроппер') ||
    l.includes('қабул қилувчи') ||
    l.includes('карта эгаси')
  ) {
    return 'DROPPER';
  }
  if (
    l.includes('tranzit') ||
    l.includes('vositachi') ||
    l.includes('транзит') ||
    l.includes('воситачи')
  ) {
    return 'TRANSIT';
  }
  if (l.includes('guvoh') || l.includes('гувоҳ') || l.includes('гувох') || l.includes('witness')) {
    return 'WITNESS';
  }
  if (
    l.includes('jabrlanuvchi') ||
    l.includes('arizachi') ||
    l.includes('жабрланувчи') ||
    l.includes('аризачи') ||
    l.includes('victim')
  ) {
    return 'VICTIM';
  }
  return 'RELATED';
}

function isSameChainDuplicate(
  a1: { id: string; repeat_type?: string | null; root_application_id?: string | null },
  a2: { id: string; repeat_type?: string | null; root_application_id?: string | null },
): boolean {
  const isDup =
    String(a1.repeat_type || '').toUpperCase() === String(ApplicationRepeatType.DUPLICATE) ||
    String(a2.repeat_type || '').toUpperCase() === String(ApplicationRepeatType.DUPLICATE);
  if (!isDup) return false;
  const r1 = a1.root_application_id || a1.id;
  const r2 = a2.root_application_id || a2.id;
  return r1 === r2;
}

@Injectable()
export class ApplicationsRelationsService {
  private readonly logger = new Logger(ApplicationsRelationsService.name);

  constructor(
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly intelligenceService: IntelligenceService,
  ) {}

  /**
   * Arizaga tegishli barcha o'tkazmalarni (asosiy + application_id + custom_fields) dublikatsiz yig'ish
   */
  private collectAllTransfers(app: Application, extraTransfers: Transfer[] = []): Transfer[] {
    const byId = new Map<string, Transfer>();
    if (app.transfer?.id) {
      byId.set(app.transfer.id, app.transfer);
    }
    for (const et of extraTransfers) {
      if (et?.id && !byId.has(et.id)) {
        byId.set(et.id, et);
      }
    }
    if (Array.isArray(app.custom_fields)) {
      for (const cf of app.custom_fields) {
        if (cf.transfer?.id && !byId.has(cf.transfer.id)) {
          byId.set(cf.transfer.id, cf.transfer);
        }
      }
    }
    return Array.from(byId.values());
  }

  /**
   * Arizaning umumiy zarar summasini (barcha UZS o'tkazmalar + kartasiz zararlar) hisoblash
   */
  private computeAppLoss(app: Application, transfers: Transfer[]): number {
    let sum = 0;
    for (const tr of transfers) {
      const curr = (tr.currency || 'UZS').toUpperCase();
      if (curr === 'UZS' && tr.amount) {
        sum += Number(tr.amount) || 0;
      }
    }
    if (Array.isArray(app.damages)) {
      for (const dmg of app.damages) {
        const curr = (dmg.currency || 'UZS').toUpperCase();
        if (curr === 'UZS' && dmg.amount) {
          sum += Number(dmg.amount) || 0;
        }
      }
    }
    if (sum === 0 && transfers.length > 0 && transfers[0].amount) {
      return Number(transfers[0].amount) || 0;
    }
    return sum;
  }

  /**
   * Arizaga tegishli barcha kartalar va ularning rollarini ajratib olish
   */
  private extractCardData(app: Application, appTransfers: Transfer[]) {
    const cardIds = new Set<string>();
    const fraudCardIds = new Set<string>();
    const cardNumbers = new Set<string>();
    const cardMap = new Map<string, { card: Card; role: CardAppRole }>();

    const rolePriority: Record<CardAppRole, number> = {
      RECEIVER: 5,
      SUSPECT: 4,
      TRANSIT: 3,
      SENDER: 2,
      RELATED: 1,
    };

    const registerCard = (card: Card | null | undefined, role: CardAppRole) => {
      if (!card || !card.id) return;
      cardIds.add(card.id);
      if (isFraudCardRole(role)) fraudCardIds.add(card.id);

      const rawNum = (card.card_number || card.masked_number || '').replace(/\D/g, '');
      if (rawNum.length >= 4) {
        cardNumbers.add(rawNum);
      }

      const existing = cardMap.get(card.id);
      if (!existing || rolePriority[role] > rolePriority[existing.role]) {
        cardMap.set(card.id, { card, role });
      }
    };

    if (app.card) registerCard(app.card, 'SENDER');
    else if (app.card_id) cardIds.add(app.card_id);

    for (const tr of appTransfers) {
      if (tr.receiver_card) registerCard(tr.receiver_card, 'RECEIVER');
      else if (tr.receiver_card_id) {
        cardIds.add(tr.receiver_card_id);
        fraudCardIds.add(tr.receiver_card_id);
      }

      if (tr.sender_card) registerCard(tr.sender_card, 'SENDER');
      else if (tr.sender_card_id) cardIds.add(tr.sender_card_id);

      if (tr.card) registerCard(tr.card, 'RELATED');
      else if (tr.card_id) cardIds.add(tr.card_id);

      if (Array.isArray(tr.custom_fields)) {
        for (const tcf of tr.custom_fields) {
          if (tcf.card) registerCard(tcf.card, 'RELATED');
          else if (tcf.card_id) cardIds.add(tcf.card_id);
        }
      }
    }

    if (Array.isArray(app.custom_fields)) {
      for (const cf of app.custom_fields) {
        const cfRole = inferCustomFieldRole(cf.label, cf.entity_role);
        const cardRole: CardAppRole =
          cfRole === 'DROPPER'
            ? 'RECEIVER'
            : cfRole === 'SUSPECT'
              ? 'SUSPECT'
              : cfRole === 'TRANSIT'
                ? 'TRANSIT'
                : cfRole === 'VICTIM'
                  ? 'SENDER'
                  : 'RELATED';
        if (cf.card) registerCard(cf.card, cardRole);
        else if (cf.card_id) {
          cardIds.add(cf.card_id);
          if (isFraudCardRole(cardRole)) fraudCardIds.add(cf.card_id);
        }
      }
    }

    return {
      cardIds: Array.from(cardIds),
      fraudCardIds: Array.from(fraudCardIds),
      cardNumbers: Array.from(cardNumbers),
      cardMap,
    };
  }

  /**
   * Arizaga tegishli barcha fuqarolar va ularning protsessual rollarini ajratib olish
   */
  private extractCitizenData(app: Application, appTransfers: Transfer[]) {
    const citizenIds = new Set<string>();
    const fraudCitizenIds = new Set<string>();
    const citizenMap = new Map<string, { citizen: Citizen; role: CitizenAppRole }>();

    const rolePriority: Record<CitizenAppRole, number> = {
      SUSPECT: 6,
      DROPPER: 5,
      TRANSIT: 4,
      VICTIM: 3,
      WITNESS: 2,
      RELATED: 1,
    };

    const registerCitizen = (citizen: Citizen | null | undefined, role: CitizenAppRole) => {
      if (!citizen || !citizen.id) return;
      citizenIds.add(citizen.id);
      if (isFraudCitizenRole(role)) fraudCitizenIds.add(citizen.id);

      const existing = citizenMap.get(citizen.id);
      if (!existing || rolePriority[role] > rolePriority[existing.role]) {
        citizenMap.set(citizen.id, { citizen, role });
      }
    };

    if (app.citizen) registerCitizen(app.citizen, 'VICTIM');
    else if (app.citizen_id) citizenIds.add(app.citizen_id);

    // Dropper (qabul qiluvchi) karta egalari — DROPPER roli bilan!
    for (const tr of appTransfers) {
      if (tr.receiver_card?.citizen) {
        registerCitizen(tr.receiver_card.citizen, 'DROPPER');
      } else if (tr.receiver_card?.citizen_id) {
        citizenIds.add(tr.receiver_card.citizen_id);
        fraudCitizenIds.add(tr.receiver_card.citizen_id);
      }
      if (Array.isArray(tr.custom_fields)) {
        for (const tcf of tr.custom_fields) {
          if (tcf.citizen) registerCitizen(tcf.citizen, inferCustomFieldRole(tcf.label));
          else if (tcf.citizen_id) citizenIds.add(tcf.citizen_id);
        }
      }
    }

    if (Array.isArray(app.custom_fields)) {
      for (const cf of app.custom_fields) {
        const cfRole = inferCustomFieldRole(cf.label, cf.entity_role);
        if (cf.citizen) registerCitizen(cf.citizen, cfRole);
        else if (cf.citizen_id) {
          citizenIds.add(cf.citizen_id);
          if (isFraudCitizenRole(cfRole)) fraudCitizenIds.add(cf.citizen_id);
        }
      }
    }

    return {
      citizenIds: Array.from(citizenIds),
      fraudCitizenIds: Array.from(fraudCitizenIds),
      citizenMap,
    };
  }

  /**
   * Arizadagi firibgar / gumonlanuvchi daraxtidan (suspect_tree) faqat bog'lanadigan (is_linkable)
   * belgilarni yagona normalizator orqali ajratib olish
   */
  private extractSuspectTokens(app: Application): {
    fieldKey: string;
    raw: string;
    normalized: string;
    path: string;
    isPhone: boolean;
    isCard: boolean;
  }[] {
    if (!app.suspect_tree || !Array.isArray(app.suspect_tree)) return [];
    const tokens: {
      fieldKey: string;
      raw: string;
      normalized: string;
      path: string;
      isPhone: boolean;
      isCard: boolean;
    }[] = [];

    const pushToken = (fieldKey: string, raw: string, path: string) => {
      const cleanKey = (fieldKey || 'other_info').trim().toLowerCase();
      if (
        !isPhoneLikeFieldKey(cleanKey) &&
        !isCardLikeFieldKey(cleanKey) &&
        !isLinkableIdentifierType(cleanKey)
      ) {
        return;
      }
      const isPhone = isPhoneLikeFieldKey(cleanKey);
      const isCard = isCardLikeFieldKey(cleanKey);
      const normalized = isPhone
        ? normalizePhoneDigits(raw)
        : isCard
          ? raw.replace(/\D/g, '')
          : normalizeIdentifierValue(cleanKey, raw);
      const minLen = isCard ? 8 : isPhone ? 7 : 3;
      if (normalized.length < minLen) return;
      tokens.push({ fieldKey: cleanKey, raw: raw.trim(), normalized, path, isPhone, isCard });
    };

    const rawItems = app.suspect_tree as unknown as Array<Record<string, unknown>>;
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      if (item.field_key !== undefined || (item.value !== undefined && !item.children)) {
        const val = typeof item.value === 'string' ? item.value.trim() : '';
        if (!val) continue;
        const fKey = typeof item.field_key === 'string' ? item.field_key : 'other_info';
        const fLabel =
          typeof item.field_label === 'string'
            ? item.field_label
            : typeof item.label === 'string'
              ? item.label
              : fKey;
        pushToken(fKey, val, fLabel);
      } else {
        const walk = (nodes: SuspectTreeNode[], currentPath: string) => {
          for (const node of nodes) {
            if (!node) continue;
            const fullPath = currentPath
              ? `${currentPath} → ${node.label || ''}`
              : node.label || '';
            if (node.value && typeof node.value === 'string' && node.value.trim().length >= 2) {
              const inferredKey = this.inferLegacyTreeKey(fullPath, node.value);
              pushToken(inferredKey, node.value, fullPath);
            }
            if (node.children && Array.isArray(node.children) && node.children.length > 0) {
              walk(node.children, fullPath);
            } else if (
              !node.value &&
              node.label &&
              typeof node.label === 'string' &&
              node.label.trim().length >= 3
            ) {
              const inferredKey = this.inferLegacyTreeKey(fullPath, node.label);
              pushToken(inferredKey, node.label, fullPath);
            }
          }
        };
        walk([item as unknown as SuspectTreeNode], '');
      }
    }

    return tokens;
  }

  private inferLegacyTreeKey(pathStr: string, val: string): string {
    const low = pathStr.toLowerCase();
    if (low.includes('telegram') && low.includes('id')) return 'telegram_id';
    if (low.includes('telegram') || val.trim().startsWith('@')) return 'telegram_username';
    if (low.includes('whatsapp')) return 'whatsapp_number';
    if (low.includes('telefon') || low.includes('phone')) return 'phone_number';
    if (low.includes('karta') || low.includes('card')) return 'card_number';
    if (low.includes('instagram')) return 'instagram_username';
    if (low.includes('ip')) return 'ip_address';
    if (low.includes('kripto') || low.includes('wallet')) return 'crypto_wallet';
    if (low.includes('imei')) return 'imei';
    if (low.includes('sayt') || low.includes('havola') || low.includes('url'))
      return 'website_domain';
    return 'other_info';
  }

  /**
   * Bosh sahifa jadvali uchun arizalarga FIRIBGAR-MARKAZLI bog'liqlik xulosalarini hisoblash.
   * Qoida: faqat kamida bir tomonda SUSPECT / DROPPER / TRANSIT roli bo'lgan kesishmalar sanaladi;
   * VICTIM ↔ VICTIM (bir fuqaroning takroriy murojaati) va bir xil zanjirdagi DUPLICATE sanalmaydi!
   */
  async attachRelationsSummaries(
    items: Application[],
    allowedDistrictIds?: string[] | null,
  ): Promise<void> {
    if (!items || items.length === 0) return;

    try {
      const itemIds = items.map((i) => i.id);

      // Faqat asosiy transferi bo'sh bo'lgan joriy sahifa arizalari uchun transfer yuklaymiz
      const missingTransferIds = items.filter((i) => !i.transfer).map((i) => i.id);
      if (missingTransferIds.length > 0) {
        const pageExtraTransfers = await this.transferRepo.find({
          where: { application_id: In(missingTransferIds) },
          relations: {
            payment_provider: true,
            sender_card: { bank: true },
            receiver_card: { bank: true },
            receiver_identifier: true,
            card: { bank: true },
          },
        });
        const transferByAppId = new Map<string, Transfer>();
        for (const t of pageExtraTransfers) {
          if (t.application_id && !transferByAppId.has(t.application_id)) {
            transferByAppId.set(t.application_id, t);
          }
        }
        for (const item of items) {
          if (!item.transfer && transferByAppId.has(item.id)) {
            item.transfer = transferByAppId.get(item.id)!;
          }
        }
      }

      if (
        allowedDistrictIds !== null &&
        allowedDistrictIds !== undefined &&
        allowedDistrictIds.length === 0
      ) {
        for (const item of items) {
          item.relations_summary = {
            total: 0,
            cards: 0,
            citizens: 0,
            suspects: 0,
            has_fraud_card_link: false,
            has_cross_role_collision: false,
            detected_crimes_count: 0,
          };
        }
        return;
      }

      const rows: Array<{
        app_id: string;
        total_count: number;
        cards_count: number;
        citizens_count: number;
        suspects_count: number;
        has_fraud_link: boolean;
        has_cross_role: boolean;
      }> = await this.applicationRepo.manager.query(
        `SELECT
           l1.application_id AS app_id,
           COUNT(DISTINCT l2.application_id)::int AS total_count,
           COUNT(DISTINCT CASE
             WHEN l1.card_id IS NOT NULL AND l1.card_id = l2.card_id THEN l2.application_id
           END)::int AS cards_count,
           COUNT(DISTINCT CASE
             WHEN l1.citizen_id IS NOT NULL AND l1.citizen_id = l2.citizen_id
              AND l1.card_id IS NULL AND l1.phone_id IS NULL AND l1.identifier_id IS NULL
             THEN l2.application_id
           END)::int AS citizens_count,
           COUNT(DISTINCT CASE
             WHEN (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id)
               OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id)
             THEN l2.application_id
           END)::int AS suspects_count,
           COALESCE(BOOL_OR(
             (l1.card_id IS NOT NULL AND l1.card_id = l2.card_id
               AND (l1.role IN ('DROPPER', 'SUSPECT', 'TRANSIT') OR l2.role IN ('DROPPER', 'SUSPECT', 'TRANSIT')))
             OR (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id
               AND (l1.role IN ('DROPPER', 'SUSPECT', 'TRANSIT') OR l2.role IN ('DROPPER', 'SUSPECT', 'TRANSIT')))
             OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id)
           ), false) AS has_fraud_link,
           COALESCE(BOOL_OR(
             (l1.role = 'VICTIM' AND l2.role IN ('DROPPER', 'SUSPECT', 'TRANSIT'))
             OR (l2.role = 'VICTIM' AND l1.role IN ('DROPPER', 'SUSPECT', 'TRANSIT'))
           ), false) AS has_cross_role
         FROM entity_application_links l1
         INNER JOIN applications a1
           ON a1.id = l1.application_id
         INNER JOIN entity_application_links l2
           ON l2.application_id <> l1.application_id
          AND (l1.role IN ('DROPPER', 'SUSPECT', 'TRANSIT') OR l2.role IN ('DROPPER', 'SUSPECT', 'TRANSIT'))
          AND (
            (l1.card_id IS NOT NULL AND l1.card_id = l2.card_id)
            OR (l1.citizen_id IS NOT NULL AND l1.citizen_id = l2.citizen_id)
            OR (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id)
            OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id)
          )
         LEFT JOIN digital_identifiers di
           ON di.id = l1.identifier_id
         LEFT JOIN suspect_field_configs sfc
           ON sfc.key = di.type
         INNER JOIN applications a2
           ON a2.id = l2.application_id
          AND a2.is_deleted = false
          AND NOT (
            (UPPER(COALESCE(a1.repeat_type, 'PRIMARY')) = 'DUPLICATE'
              OR UPPER(COALESCE(a2.repeat_type, 'PRIMARY')) = 'DUPLICATE')
            AND COALESCE(a1.root_application_id, a1.id) = COALESCE(a2.root_application_id, a2.id)
          )
         WHERE l1.application_id = ANY($1::uuid[])
           AND (
             di.id IS NULL
             OR (
               di.type NOT IN ('telegram_bio', 'other_info')
               AND COALESCE(sfc.is_linkable, true) = true
             )
           )
         GROUP BY l1.application_id`,
        [itemIds],
      );

      // Aniqlangan jinoyatlar (detected_crimes) bilan kesishmalar sonini ham tezkor batch SQL bilan olamiz
      let dcCountMap = new Map<string, number>();
      try {
        const dcRows: Array<{ app_id: string; dc_count: number }> =
          await this.applicationRepo.manager.query(
            `SELECT l.application_id AS app_id, COUNT(DISTINCT dc.id)::int AS dc_count
             FROM entity_application_links l
             LEFT JOIN cards crd ON crd.id = l.card_id
             LEFT JOIN phones ph ON ph.id = l.phone_id
             LEFT JOIN digital_identifiers di ON di.id = l.identifier_id
             INNER JOIN detected_crimes dc ON dc.is_deleted = false
             WHERE l.application_id = ANY($1::uuid[])
               AND l.role IN ('DROPPER', 'SUSPECT', 'TRANSIT')
               AND (
                 (l.citizen_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM detected_crime_suspects dcs
                   WHERE dcs.detected_crime_id = dc.id AND dcs.citizen_id = l.citizen_id
                 ))
                 OR (crd.card_number IS NOT NULL AND LENGTH(crd.card_number) >= 8 AND EXISTS (
                   SELECT 1 FROM detected_crime_evidences dce
                   WHERE dce.detected_crime_id = dc.id
                     AND dce.identifier_value IS NOT NULL
                     AND REGEXP_REPLACE(dce.identifier_value, '[^0-9]', '', 'g') = crd.card_number
                 ))
                 OR (ph.phone_number IS NOT NULL AND LENGTH(ph.phone_number) >= 7 AND EXISTS (
                   SELECT 1 FROM detected_crime_evidences dce
                   WHERE dce.detected_crime_id = dc.id
                     AND dce.identifier_value IS NOT NULL
                     AND RIGHT(REGEXP_REPLACE(dce.identifier_value, '[^0-9]', '', 'g'), 9) = RIGHT(ph.phone_number, 9)
                 ))
                 OR (di.normalized_value IS NOT NULL AND LENGTH(di.normalized_value) >= 3
                     AND di.type NOT IN ('telegram_bio', 'other_info')
                     AND (
                       (dc.channel_or_source_url IS NOT NULL AND LOWER(dc.channel_or_source_url) LIKE '%' || di.normalized_value || '%')
                       OR EXISTS (
                         SELECT 1 FROM detected_crime_evidences dce
                         WHERE dce.detected_crime_id = dc.id
                           AND dce.identifier_value IS NOT NULL
                           AND LOWER(dce.identifier_value) LIKE '%' || di.normalized_value || '%'
                       )
                     ))
               )
             GROUP BY l.application_id`,
            [itemIds],
          );
        dcCountMap = new Map(dcRows.map((r) => [r.app_id, Number(r.dc_count || 0)]));
      } catch {
        // detected_crimes jadvali hali bo'lmasa yoki test mockida bo'lsa e'tiborsiz qoldiramiz
      }

      const summaryMap = new Map(rows.map((r) => [r.app_id, r]));
      for (const item of items) {
        const s = summaryMap.get(item.id);
        item.relations_summary = {
          total: Number(s?.total_count || 0),
          cards: Number(s?.cards_count || 0),
          citizens: Number(s?.citizens_count || 0),
          suspects: Number(s?.suspects_count || 0),
          has_fraud_card_link: Boolean(s?.has_fraud_link),
          has_cross_role_collision: Boolean(s?.has_cross_role),
          detected_crimes_count: dcCountMap.get(item.id) || 0,
        };
      }
    } catch (err) {
      this.logger.warn(
        `attachRelationsSummaries xatolik: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Tanlangan arizaning FIRIBGAR-MARKAZLI bog'liqliklari
   * (Dropper/Suspect kartalar, gumonlanuvchi telefon va raqamli izlar, rol to'qnashuvi,
   *  ko'p qadamli firibgar zanjirlari, aniqlangan jinoyatlar va to'liq moliyaviy graf)
   */
  async getRelations(currentApp: Application, currentUser?: JwtAccessPayload) {
    const id = currentApp.id;

    // Joriy arizaning BARCHA o'tkazmalarini yuklaymiz (faqat 1-o'tkazma emas!)
    const currentAppExtraTransfers = await this.transferRepo.find({
      where: { application_id: currentApp.id },
      relations: {
        payment_provider: true,
        sender_card: { bank: true, citizen: true },
        receiver_card: { bank: true, citizen: true },
        receiver_identifier: true,
        card: { bank: true, citizen: true },
        custom_fields: { card: { bank: true, citizen: true }, citizen: true },
      },
      order: { created_at: 'ASC' },
    });
    const currentTransfers = this.collectAllTransfers(currentApp, currentAppExtraTransfers);
    if (!currentApp.transfer && currentTransfers.length > 0) {
      currentApp.transfer = currentTransfers[0];
    }

    const cardData = this.extractCardData(currentApp, currentTransfers);
    const citizenData = this.extractCitizenData(currentApp, currentTransfers);
    const currentSuspectTokens = this.extractSuspectTokens(currentApp);

    const curCardIds = Array.from(cardData.cardMap.keys());
    const curFraudCardIds = cardData.fraudCardIds;
    const curFraudCitizenIds = citizenData.fraudCitizenIds;
    const curFraudPinfls = Array.from(citizenData.citizenMap.values())
      .filter((e) => isFraudCitizenRole(e.role))
      .map((e) => e.citizen.pinfl?.trim())
      .filter((v): v is string => Boolean(v));
    const curFraudPassports = Array.from(citizenData.citizenMap.values())
      .filter((e) => isFraudCitizenRole(e.role))
      .map((e) => e.citizen.passport?.trim().toUpperCase())
      .filter((v): v is string => Boolean(v));
    const curFraudPhones = Array.from(
      new Set([
        ...Array.from(citizenData.citizenMap.values())
          .filter((e) => isFraudCitizenRole(e.role))
          .map((e) => normalizePhoneDigits(e.citizen.phone_number))
          .filter((v) => v.length >= 7),
        ...currentSuspectTokens.filter((t) => t.isPhone).map((t) => t.normalized),
      ]),
    );
    const curSuspectLikePatterns = Array.from(
      new Set(
        currentSuspectTokens
          .map((t) => t.normalized.trim().toLowerCase())
          .filter((v) => v.length >= 4)
          .slice(0, 25)
          .map((v) => `%${v.replace(/[%_\\]/g, '\\$&')}%`),
      ),
    );

    // Nomzod bog'liq arizalar: faqat firibgar / dropper / rol-to'qnashuvi bo'yicha!
    const candidateRows: Array<{ app_id: string }> = await this.applicationRepo.manager.query(
      `SELECT DISTINCT a2.id AS app_id
       FROM applications a2
       LEFT JOIN citizens c2 ON c2.id = a2.citizen_id
       LEFT JOIN transfers t2 ON t2.id = a2.transfer_id OR t2.application_id = a2.id
       WHERE a2.is_deleted = false
         AND a2.id <> $1::uuid
         AND (
           EXISTS (
             SELECT 1
             FROM entity_application_links l1
             INNER JOIN entity_application_links l2
               ON l2.application_id = a2.id
              AND (l1.role IN ('DROPPER', 'SUSPECT', 'TRANSIT') OR l2.role IN ('DROPPER', 'SUSPECT', 'TRANSIT'))
              AND (
                (l1.card_id IS NOT NULL AND l1.card_id = l2.card_id)
                OR (l1.citizen_id IS NOT NULL AND l1.citizen_id = l2.citizen_id)
                OR (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id)
                OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id)
              )
             LEFT JOIN digital_identifiers di ON di.id = l1.identifier_id
             WHERE l1.application_id = $1::uuid
               AND (di.id IS NULL OR di.type NOT IN ('telegram_bio', 'other_info'))
           )
           OR (cardinality($2::uuid[]) > 0 AND (
             a2.card_id = ANY($2::uuid[])
             OR t2.sender_card_id = ANY($2::uuid[])
             OR t2.receiver_card_id = ANY($2::uuid[])
           ))
           OR (cardinality($3::uuid[]) > 0 AND t2.receiver_card_id = ANY($3::uuid[]))
           OR (cardinality($4::uuid[]) > 0 AND a2.citizen_id = ANY($4::uuid[]))
           OR (cardinality($5::text[]) > 0 AND c2.pinfl = ANY($5::text[]))
           OR (cardinality($6::text[]) > 0 AND UPPER(c2.passport) = ANY($6::text[]))
           OR (cardinality($7::text[]) > 0 AND (
             REGEXP_REPLACE(COALESCE(c2.phone_number, ''), '[^0-9]', '', 'g') = ANY($7::text[])
             OR RIGHT(REGEXP_REPLACE(COALESCE(c2.phone_number, ''), '[^0-9]', '', 'g'), 9) = ANY(
               SELECT RIGHT(p, 9) FROM unnest($7::text[]) AS p
             )
           ))
           OR (cardinality($8::text[]) > 0 AND a2.suspect_tree IS NOT NULL AND LOWER(a2.suspect_tree::text) LIKE ANY($8::text[]))
         )
       LIMIT 200`,
      [
        id,
        curFraudCardIds,
        curCardIds,
        curFraudCitizenIds,
        curFraudPinfls,
        curFraudPassports,
        curFraudPhones,
        curSuspectLikePatterns,
      ],
    );

    const candidateIds = candidateRows.map((r) => r.app_id);

    const [otherAppsRaw, allCandidateTransfers] =
      candidateIds.length > 0
        ? await Promise.all([
            this.applicationRepo.find({
              where: { id: In(candidateIds), is_deleted: false },
              relations: {
                application_status: true,
                citizen: { district: true, neighborhood: true },
                district: true,
                crime: true,
                crime_method: { fields: true },
                card: { bank: true, citizen: true },
                damages: true,
                transfer: {
                  payment_provider: true,
                  sender_card: { bank: true, citizen: true },
                  receiver_card: { bank: true, citizen: true },
                  receiver_identifier: true,
                  card: { bank: true, citizen: true },
                  custom_fields: { card: { bank: true, citizen: true }, citizen: true },
                },
                custom_fields: {
                  citizen: { district: true, neighborhood: true },
                  card: { bank: true, citizen: true },
                  crime: true,
                  district: true,
                  transfer: {
                    payment_provider: true,
                    sender_card: { bank: true, citizen: true },
                    receiver_card: { bank: true, citizen: true },
                    receiver_identifier: true,
                  },
                },
              },
              order: { date: 'DESC', created_at: 'DESC' },
            }),
            this.transferRepo.find({
              where: { application_id: In(candidateIds) },
              relations: {
                payment_provider: true,
                sender_card: { bank: true, citizen: true },
                receiver_card: { bank: true, citizen: true },
                receiver_identifier: true,
                card: { bank: true, citizen: true },
                custom_fields: { card: { bank: true, citizen: true }, citizen: true },
              },
              order: { created_at: 'ASC' },
            }),
          ])
        : [[], []];

    // Bir xil hodisaning DUPLICATE arizasini chiqarib tashlaymiz
    const otherApps = otherAppsRaw.filter((other) => !isSameChainDuplicate(currentApp, other));

    // Har bir nomzod arizaning BARCHA o'tkazmalarini massiv ko'rinishida yig'amiz
    const transfersByAppId = new Map<string, Transfer[]>();
    for (const t of allCandidateTransfers) {
      if (!t.application_id) continue;
      const list = transfersByAppId.get(t.application_id) || [];
      list.push(t);
      transfersByAppId.set(t.application_id, list);
    }

    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const isRestrictedOtherApp = (other: Application): boolean =>
      allowedDistrictIds !== null &&
      (!other.district_id || !allowedDistrictIds.includes(other.district_id));

    const otherAppTransfersMap = new Map<string, Transfer[]>();
    for (const other of otherApps) {
      const merged = this.collectAllTransfers(other, transfersByAppId.get(other.id) || []);
      otherAppTransfersMap.set(other.id, merged);
      if (!other.transfer && merged.length > 0) {
        other.transfer = merged[0];
      }
    }

    // Joriy arizachining o'z avvalgi murojaatlari (alohida, firibgar bog'liqligidan ajratilgan!)
    let applicantRepeatApplications: LinkedApplicationSummary[] = [];
    if (currentApp.citizen_id) {
      const repeatApps = await this.applicationRepo.find({
        where: { citizen_id: currentApp.citizen_id, is_deleted: false },
        relations: {
          application_status: true,
          district: true,
          crime: true,
          transfer: { payment_provider: true },
          damages: true,
        },
        order: { date: 'DESC', created_at: 'DESC' },
        take: 25,
      });
      applicantRepeatApplications = repeatApps
        .filter((a) => a.id !== currentApp.id)
        .map((a) => {
          const restricted = isRestrictedOtherApp(a);
          const loss = this.computeAppLoss(a, a.transfer ? [a.transfer] : []);
          return {
            id: a.id,
            application_number: restricted
              ? 'Boshqa tuman arizasi'
              : a.application_number || 'Raqamsiz',
            status: a.status,
            status_label: a.application_status?.name || a.status || 'Yangi',
            status_color: a.application_status?.color || 'blue',
            date: a.date,
            district_name: restricted ? 'Boshqa tuman' : a.district?.name || null,
            crime_article: a.crime?.article || null,
            citizen_name: restricted
              ? 'Boshqa tuman fuqarosi'
              : currentApp.citizen?.full_name?.trim() || 'Arizachi',
            role_in_that_app: 'VICTIM',
            transfer_amount: loss || null,
            currency: a.transfer?.currency || 'UZS',
            payment_provider: a.transfer?.payment_provider?.name || null,
            description: restricted ? 'Boshqa tuman yurituvidagi ariza' : a.description || null,
          };
        });
    }

    const toAppSummary = (
      other: Application,
      roleInOther: string,
      isCrossRole = false,
    ): LinkedApplicationSummary => {
      const restricted = isRestrictedOtherApp(other);
      const otherTransfers =
        otherAppTransfersMap.get(other.id) || (other.transfer ? [other.transfer] : []);
      const loss = this.computeAppLoss(other, otherTransfers);
      return {
        id: other.id,
        application_number: restricted
          ? 'Boshqa tuman arizasi'
          : other.application_number || 'Raqamsiz',
        status: other.status,
        status_label: other.application_status?.name || other.status || 'Yangi',
        status_color: other.application_status?.color || 'blue',
        date: other.date,
        district_name: restricted ? 'Boshqa tuman' : other.district?.name || null,
        crime_article: other.crime?.article || null,
        citizen_name: restricted
          ? 'Boshqa tuman fuqarosi'
          : other.citizen?.full_name?.trim() || 'Arizachi kiritilmagan',
        citizen_phone: restricted ? null : other.citizen?.phone_number || null,
        role_in_that_app: roleInOther,
        transfer_amount: loss || null,
        currency: otherTransfers[0]?.currency || 'UZS',
        payment_provider: otherTransfers[0]?.payment_provider?.name || null,
        description: restricted ? 'Boshqa tuman yurituvidagi ariza' : other.description || null,
        is_cross_role: isCrossRole,
      };
    };

    const cardRelationsMap = new Map<
      string,
      {
        card: CardRelationSummary;
        role_in_current_app: CardAppRole;
        linked_applications: LinkedApplicationSummary[];
      }
    >();

    const citizenRelationsMap = new Map<
      string,
      {
        citizen: CitizenRelationSummary;
        role_in_current_app: CitizenAppRole;
        match_reasons: Set<string>;
        linked_applications: LinkedApplicationSummary[];
      }
    >();

    const suspectRelationsMap = new Map<
      string,
      {
        field_path: string;
        value: string;
        matched_with: string;
        linked_applications: LinkedApplicationSummary[];
      }
    >();

    const unifiedAppsMap = new Map<string, UnifiedLinkedApplication>();
    const addUnifiedMatch = (
      other: Application,
      roleInOther: string,
      reason: RelationMatchReason,
      isCrossRole = false,
    ) => {
      let existing = unifiedAppsMap.get(other.id);
      if (!existing) {
        existing = {
          ...toAppSummary(other, roleInOther, isCrossRole),
          match_reasons: [],
          is_cross_role: isCrossRole,
          has_fraud_match: reason.danger,
        };
        unifiedAppsMap.set(other.id, existing);
      }
      if (isCrossRole) existing.is_cross_role = true;
      if (reason.danger) existing.has_fraud_match = true;
      const dedupKey = `${reason.kind}:${reason.label}:${reason.value}`;
      if (!existing.match_reasons.some((r) => `${r.kind}:${r.label}:${r.value}` === dedupKey)) {
        existing.match_reasons.push(reason);
      }
    };

    const linkedApplicationIds = new Set<string>();
    let hasFraudCardLink = false;
    let hasCrossRoleCollision = false;

    const formatCardShort = (c: Card) => {
      const clean = (c.card_number || c.masked_number || '').replace(/\D/g, '');
      if (clean.length === 16) {
        return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 12)} ${clean.slice(12, 16)}`;
      }
      return c.masked_number || c.card_number || 'Karta';
    };

    // Har bir nomzod arizani tekshirish — FAQAT FIRIBGAR / DROPPER / ROL TO'QNASHUVI
    for (const other of otherApps) {
      const otherTransfers = otherAppTransfersMap.get(other.id) || [];
      const otherCardData = this.extractCardData(other, otherTransfers);
      const otherCitizenData = this.extractCitizenData(other, otherTransfers);

      let isLinked = false;

      // 1. KARTALAR BO'YICHA TEKSHIRUV (SENDER ↔ SENDER jabrlanuvchi kartasi kirmaydi!)
      for (const [cardId, currentCardEntry] of cardData.cardMap.entries()) {
        const currentCard = currentCardEntry.card;
        const currentNum = (currentCard.card_number || currentCard.masked_number || '').replace(
          /\D/g,
          '',
        );

        let otherRole: CardAppRole | null = null;
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

        if (!otherRole) continue;

        const curIsFraud = isFraudCardRole(currentCardEntry.role);
        const othIsFraud = isFraudCardRole(otherRole);
        // Faqat kamida bitta tomonda firibgar/dropper/tranzit karta bo'lsa!
        if (!curIsFraud && !othIsFraud) continue;

        const isCross = curIsFraud !== othIsFraud;
        isLinked = true;
        hasFraudCardLink = true;
        if (isCross) hasCrossRoleCollision = true;

        if (!cardRelationsMap.has(cardId)) {
          cardRelationsMap.set(cardId, {
            card: {
              id: currentCard.id,
              card_number: currentCard.card_number,
              masked_number: currentCard.masked_number,
              full_name: currentCard.full_name,
              bank_name: currentCard.bank?.name || null,
              citizen_id: currentCard.citizen?.id || currentCard.citizen_id || null,
              citizen_name: currentCard.citizen?.full_name?.trim() || null,
            },
            role_in_current_app: currentCardEntry.role,
            linked_applications: [],
          });
        }

        const cardRel = cardRelationsMap.get(cardId)!;
        if (!cardRel.linked_applications.some((a) => a.id === other.id)) {
          cardRel.linked_applications.push(toAppSummary(other, otherRole, isCross));
        }

        addUnifiedMatch(
          other,
          otherRole,
          {
            kind: isCross ? 'CROSS_ROLE' : 'CARD',
            label: isCross
              ? 'Karta rol toʻqnashuvi'
              : currentCardEntry.role === 'RECEIVER'
                ? 'Dropper / Firibgar kartasi'
                : 'Gumonlanuvchi kartasi',
            value: formatCardShort(currentCard),
            danger: true,
          },
          isCross,
        );
      }

      // 2. FUQAROLAR BO'YICHA TEKSHIRUV (VICTIM ↔ VICTIM qat'iyan chiqarib tashlanadi!)
      for (const [citizenId, currentEntry] of citizenData.citizenMap.entries()) {
        const currentCitizen = currentEntry.citizen;
        const curIsFraud = isFraudCitizenRole(currentEntry.role);

        for (const [otherCitizenId, otherEntry] of otherCitizenData.citizenMap.entries()) {
          const otherCitizen = otherEntry.citizen;
          const othIsFraud = isFraudCitizenRole(otherEntry.role);
          // Ikkala tomonda ham oddiy jabrlanuvchi/guvoh bo'lsa o'tkazib yuboramiz!
          if (!curIsFraud && !othIsFraud) continue;

          const reasons = new Set<string>();
          if (otherCitizenId === citizenId) {
            reasons.add(
              curIsFraud !== othIsFraud
                ? 'Rol toʻqnashuvi (Jabrlanuvchi ↔ Firibgar/Dropper)'
                : 'Ayni gumonlanuvchi / dropper shaxs',
            );
          }
          if (
            currentCitizen.pinfl &&
            otherCitizen.pinfl &&
            currentCitizen.pinfl.trim() === otherCitizen.pinfl.trim()
          ) {
            reasons.add(`Bir xil JSHSHIR: ${currentCitizen.pinfl.trim()}`);
          }
          if (
            currentCitizen.passport &&
            otherCitizen.passport &&
            currentCitizen.passport.trim().toUpperCase() ===
              otherCitizen.passport.trim().toUpperCase()
          ) {
            reasons.add(`Bir xil Pasport: ${currentCitizen.passport.trim().toUpperCase()}`);
          }
          const curPhone = normalizePhoneDigits(currentCitizen.phone_number);
          const othPhone = normalizePhoneDigits(otherCitizen.phone_number);
          if (curPhone.length >= 7 && othPhone.length >= 7 && curPhone === othPhone) {
            reasons.add(`Bir xil Telefon: +${curPhone}`);
          }

          if (reasons.size === 0) continue;

          const isCross = curIsFraud !== othIsFraud;
          isLinked = true;
          if (isCross) hasCrossRoleCollision = true;

          if (!citizenRelationsMap.has(citizenId)) {
            citizenRelationsMap.set(citizenId, {
              citizen: {
                id: currentCitizen.id,
                full_name: currentCitizen.full_name,
                phone_number: currentCitizen.phone_number,
                passport: currentCitizen.passport,
                pinfl: currentCitizen.pinfl,
              },
              role_in_current_app: currentEntry.role,
              match_reasons: new Set(),
              linked_applications: [],
            });
          }

          const citRel = citizenRelationsMap.get(citizenId)!;
          reasons.forEach((r) => citRel.match_reasons.add(r));
          if (!citRel.linked_applications.some((a) => a.id === other.id)) {
            citRel.linked_applications.push(toAppSummary(other, otherEntry.role, isCross));
          }

          addUnifiedMatch(
            other,
            otherEntry.role,
            {
              kind: isCross ? 'CROSS_ROLE' : 'CITIZEN',
              label: isCross
                ? 'Shaxs rol toʻqnashuvi'
                : currentEntry.role === 'DROPPER'
                  ? 'Dropper shaxs'
                  : 'Gumonlanuvchi shaxs',
              value: currentCitizen.full_name?.trim() || currentCitizen.phone_number || 'Shaxs',
              danger: true,
            },
            isCross,
          );
        }
      }

      // 3. GUMONLANUVCHI BELGILARI (SUSPECT TREE) BO'YICHA TEKSHIRUV
      const otherSuspectTokens = this.extractSuspectTokens(other);
      for (const curTok of currentSuspectTokens) {
        for (const othTok of otherSuspectTokens) {
          if (curTok.normalized === othTok.normalized) {
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
              sRel.linked_applications.push(toAppSummary(other, 'SUSPECT', false));
            }

            addUnifiedMatch(other, 'SUSPECT', {
              kind: curTok.isPhone ? 'PHONE' : curTok.isCard ? 'CARD' : 'IDENTIFIER',
              label: curTok.path || 'Gumonlanuvchi belgisi',
              value: curTok.raw,
              danger: true,
            });
          }
        }

        // Cross-role: joriy arizadagi gumonlanuvchi telefoni boshqa arizadagi fuqaro telefoni bilan mos kelsa!
        if (curTok.isPhone) {
          for (const [, othCitEntry] of otherCitizenData.citizenMap.entries()) {
            const othPhone = normalizePhoneDigits(othCitEntry.citizen.phone_number);
            if (othPhone.length >= 7 && othPhone === curTok.normalized) {
              const isCross = !isFraudCitizenRole(othCitEntry.role);
              isLinked = true;
              hasFraudCardLink = true;
              if (isCross) hasCrossRoleCollision = true;

              const suspectKey = `${curTok.path}:${curTok.normalized}`;
              if (!suspectRelationsMap.has(suspectKey)) {
                suspectRelationsMap.set(suspectKey, {
                  field_path: curTok.path,
                  value: curTok.raw,
                  matched_with: othCitEntry.citizen.phone_number || curTok.raw,
                  linked_applications: [],
                });
              }
              const sRel = suspectRelationsMap.get(suspectKey)!;
              if (!sRel.linked_applications.some((a) => a.id === other.id)) {
                sRel.linked_applications.push(toAppSummary(other, othCitEntry.role, isCross));
              }

              addUnifiedMatch(
                other,
                othCitEntry.role,
                {
                  kind: isCross ? 'CROSS_ROLE' : 'PHONE',
                  label: isCross ? 'Telefon rol toʻqnashuvi' : 'Gumonlanuvchi telefoni',
                  value: curTok.raw,
                  danger: true,
                },
                isCross,
              );
            }
          }
        }
      }

      if (isLinked) {
        linkedApplicationIds.add(other.id);
      }
    }

    // Intelligence boyitish (clue_relations, multi_hop_chains, probable_matches, detected_crime_relations, network_graph)
    const enhanced = await this.intelligenceService.getEnhancedApplicationIntelligence(
      currentApp.id,
      currentUser,
    );

    // Intelligence clue_relations orqali topilgan arizalarni ham unified ro'yxatga qo'shamiz
    for (const cl of enhanced.clue_relations) {
      for (const la of cl.linked_applications) {
        if (la.id === currentApp.id) continue;
        linkedApplicationIds.add(la.id);
        const isCross = cl.role_in_current_app === 'VICTIM' || la.role_in_app === 'VICTIM';
        if (isCross) hasCrossRoleCollision = true;
        hasFraudCardLink = true;

        let existing = unifiedAppsMap.get(la.id);
        if (!existing) {
          existing = {
            id: la.id,
            application_number: la.application_number,
            status: la.status,
            status_label: la.status_label,
            status_color: la.status_color,
            date: la.date ? new Date(la.date) : null,
            district_name: la.district_name || null,
            crime_article: la.crime_article || null,
            citizen_name: la.victim_name || 'Arizachi kiritilmagan',
            citizen_phone: la.victim_phone || null,
            role_in_that_app: la.role_in_app,
            transfer_amount: la.transfer_amount,
            currency: la.currency || 'UZS',
            payment_provider: la.payment_provider || null,
            description: la.description,
            match_reasons: [],
            is_cross_role: isCross,
            has_fraud_match: true,
          };
          unifiedAppsMap.set(la.id, existing);
        }
        if (isCross) existing.is_cross_role = true;
        const reason: RelationMatchReason = {
          kind: isCross ? 'CROSS_ROLE' : cl.entity_type === 'phone' ? 'PHONE' : 'IDENTIFIER',
          label: cl.label,
          value: cl.value,
          danger: true,
        };
        const dedupKey = `${reason.kind}:${reason.label}:${reason.value}`;
        if (!existing.match_reasons.some((r) => `${r.kind}:${r.label}:${r.value}` === dedupKey)) {
          existing.match_reasons.push(reason);
        }
      }
    }

    const cardRelations = Array.from(cardRelationsMap.values());
    const citizenRelations = Array.from(citizenRelationsMap.values()).map((cr) => ({
      ...cr,
      match_reasons: Array.from(cr.match_reasons),
    }));

    const unifiedLinkedApplications = Array.from(unifiedAppsMap.values()).sort((a, b) => {
      if (a.is_cross_role !== b.is_cross_role) return a.is_cross_role ? -1 : 1;
      if (b.match_reasons.length !== a.match_reasons.length) {
        return b.match_reasons.length - a.match_reasons.length;
      }
      const dA = a.date ? new Date(a.date).getTime() : 0;
      const dB = b.date ? new Date(b.date).getTime() : 0;
      return dB - dA;
    });

    // Zarar hisobi (barcha bog'langan arizalar + multi-hop, dublikatsiz)
    const currentAppLoss = this.computeAppLoss(currentApp, currentTransfers);
    let totalLinkedLoss = 0;
    const countedAppIds = new Set<string>([currentApp.id]);
    for (const ula of unifiedLinkedApplications) {
      if (!countedAppIds.has(ula.id) && ula.transfer_amount) {
        const matchedEntity = otherApps.find((o) => o.id === ula.id);
        if (!matchedEntity || shouldIncludeInDamageTotal(matchedEntity.repeat_type)) {
          totalLinkedLoss += ula.transfer_amount;
        }
        countedAppIds.add(ula.id);
      }
    }
    for (const mh of enhanced.multi_hop_chains) {
      const ta = mh.target_application;
      if (!countedAppIds.has(ta.id) && ta.transfer_amount) {
        totalLinkedLoss += ta.transfer_amount;
        countedAppIds.add(ta.id);
      }
    }

    // =========================================================================
    // MOLIYAVIY GRAF (BARCHA O'TKAZMALAR + KRIPTO/SERVIS/HISOB RAQAM CHIQISHLARI)
    // =========================================================================
    const graphNodesMap = new Map<string, RelationGraphNode>();
    const graphEdges: RelationGraphEdge[] = [];

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
        const owner =
          card.citizen?.full_name?.trim() || card.full_name || 'Karta egasi ko‘rsatilmagan';

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
        node.linkedApplications.push(toAppSummary(appContext, defaultRole, false));
      }

      return node;
    };

    const allRelevantApps = [
      currentApp,
      ...otherApps.filter((o) => linkedApplicationIds.has(o.id)),
    ];

    for (const appItem of allRelevantApps) {
      const appItemTransfers =
        appItem.id === currentApp.id
          ? currentTransfers
          : otherAppTransfersMap.get(appItem.id) || (appItem.transfer ? [appItem.transfer] : []);

      for (const tr of appItemTransfers) {
        const amt = tr.amount ? Number(tr.amount) : 0;
        const providerName = tr.payment_provider?.name || 'To‘lov tizimi';
        const restricted = appItem.id !== currentApp.id && isRestrictedOtherApp(appItem);

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
          const citLabel = restricted
            ? 'Boshqa tuman fuqarosi'
            : appItem.citizen.full_name?.trim() || 'Arizachi';
          if (!graphNodesMap.has(citNodeId)) {
            graphNodesMap.set(citNodeId, {
              id: citNodeId,
              cardNumber: citLabel,
              maskedCard: citLabel,
              bankName: restricted
                ? 'Boshqa tuman arizasi'
                : `Ariza № ${appItem.application_number || 'Raqamsiz'}`,
              totalIn: 0,
              totalOut: 0,
              netFlow: 0,
              inDegree: 0,
              outDegree: 0,
              reportsCount: 1,
              reportIds: [appItem.id],
              riskScore: 10,
              role: 'VICTIM_SOURCE',
              isBlacklisted: false,
              ownerName: citLabel,
              pinfl: restricted ? '' : appItem.citizen.pinfl || '',
              passport: restricted ? '' : appItem.citizen.passport || '',
              phone: restricted ? '' : appItem.citizen.phone_number || '',
              linkedApplications: [toAppSummary(appItem, 'VICTIM_SOURCE', false)],
            });
          }
          const cNode = graphNodesMap.get(citNodeId)!;
          cNode.totalOut += amt;
          cNode.outDegree += 1;
          srcNodeId = citNodeId;
        }

        const destType = tr.destination_type || TransferDestinationType.CARD;
        if (
          destType !== TransferDestinationType.CARD ||
          (!tr.receiver_card && (tr.receiver_identifier || tr.destination_label))
        ) {
          const ident = tr.receiver_identifier;
          const details = (tr.destination_details || {}) as Record<string, string | undefined>;
          const displayLabel =
            tr.destination_label ||
            (ident ? `${ident.type_label || ident.type}: ${ident.raw_value}` : null) ||
            details.value ||
            details.platform ||
            'Chiqish manzili';

          const destNodeId = ident
            ? `ident__${ident.id}`
            : `dest__${destType}__${displayLabel.toLowerCase().trim()}`;
          const destRole: RelationGraphNode['role'] =
            destType === TransferDestinationType.CRYPTO
              ? 'CRYPTO_CASHOUT'
              : destType === TransferDestinationType.CASH
                ? 'ATM_TERMINAL'
                : destType === TransferDestinationType.BANK_ACCOUNT
                  ? 'BANK_ACCOUNT_OUT'
                  : 'PLATFORM_CASHOUT';

          if (!graphNodesMap.has(destNodeId)) {
            graphNodesMap.set(destNodeId, {
              id: destNodeId,
              cardNumber: displayLabel,
              maskedCard: displayLabel,
              bankName: details.platform || ident?.type_label || String(destType),
              totalIn: 0,
              totalOut: 0,
              netFlow: 0,
              inDegree: 0,
              outDegree: 0,
              reportsCount: 0,
              reportIds: [],
              riskScore: 80,
              role: destRole,
              isBlacklisted: false,
              destinationType: destType,
              identifierId: ident?.id || undefined,
              linkedApplications: [],
            });
          }
          const dNode = graphNodesMap.get(destNodeId)!;
          dNode.totalIn += amt;
          dNode.inDegree += 1;
          if (!dNode.reportIds.includes(appItem.id)) {
            dNode.reportIds.push(appItem.id);
            dNode.reportsCount = dNode.reportIds.length;
            dNode.linkedApplications.push(toAppSummary(appItem, 'DROPPER', false));
          }
          tgtNodeId = destNodeId;
        } else if (tr.receiver_card) {
          const rNode = ensureCardNode(tr.receiver_card, 'MULE_DROPPER', appItem);
          if (rNode) {
            rNode.totalIn += amt;
            rNode.inDegree += 1;
            tgtNodeId = rNode.id;
          }
        } else {
          const unkNodeId = `unk__${appItem.id}__${tr.id}`;
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
              linkedApplications: [toAppSummary(appItem, 'MULE_DROPPER', false)],
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
            applicationNumber: restricted
              ? 'Boshqa tuman arizasi'
              : appItem.application_number || 'Raqamsiz',
            applicationId: appItem.id,
            isUnknownDestination: graphNodesMap.get(tgtNodeId)?.isUnknownDestination || false,
          });
        }
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

    const uniqueMultiHopCount = enhanced.multi_hop_chains.filter(
      (m) => !unifiedAppsMap.has(m.target_application.id),
    ).length;

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
        transfers: currentTransfers,
        suspect_tree: currentApp.suspect_tree || [],
      },
      stats: {
        total_linked_applications: unifiedLinkedApplications.length + uniqueMultiHopCount,
        total_linked_loss: totalLinkedLoss,
        current_app_loss: currentAppLoss,
        grand_total_loss: currentAppLoss + totalLinkedLoss,
        total_cards_count: cardRelations.length,
        total_citizens_count: citizenRelations.length,
        total_suspects_count: Math.max(
          suspectRelationsMap.size,
          enhanced.clue_relations.filter((c) => c.linked_applications.length > 0).length,
        ),
        total_multi_hop_count: enhanced.multi_hop_chains.length,
        detected_crimes_count: enhanced.detected_crime_relations.length,
        has_fraud_card_link: hasFraudCardLink,
        has_cross_role_collision: hasCrossRoleCollision,
      },
      linked_applications: unifiedLinkedApplications,
      applicant_repeat_applications: applicantRepeatApplications,
      card_relations: cardRelations,
      citizen_relations: citizenRelations,
      suspect_relations: Array.from(suspectRelationsMap.values()),
      clue_relations: enhanced.clue_relations,
      multi_hop_chains: enhanced.multi_hop_chains,
      probable_matches: enhanced.probable_matches,
      detected_crime_relations: enhanced.detected_crime_relations,
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
    const p6 = clean.substring(0, 6);
    const p4 = clean.substring(0, 4);

    if (p6 === '986003' || p6 === '986004') return 'Ipak Yo‘li Banki';
    if (p6 === '860002') return 'O‘zsanoatqurilishbank';
    if (p6 === '860004') return 'Agrobank';
    if (p6 === '860006') return 'Xalq Banki';
    if (p6 === '860012') return 'Milliy Bank (NBU)';
    if (p6 === '860014') return 'Hamkorbank';
    if (p6 === '860031') return 'Ipoteka Bank';
    if (p6 === '860048') return 'Anorbank';
    if (p6 === '986016') return 'Anorbank Humo';
    if (p6 === '986024') return 'TBC Bank Humo';
    if (p6 === '986035') return 'Payme Card';
    if (p6 === '986060') return 'Uzum Bank';
    if (p6 === '400845') return 'Xalq Banki (Visa)';
    if (p6 === '415865') return 'Kapitalbank (Visa)';
    if (p6 === '416973') return 'Ipak Yo‘li Banki (Visa)';
    if (p6 === '427209') return 'Hamkorbank (Visa)';

    if (p4 === '8600') return 'Uzcard';
    if (p4 === '9860') return 'Humo';
    if (p4 === '5614') return 'Uzcard Cobadged';
    if (p4.startsWith('4')) return 'Visa';
    if (p4.startsWith('5')) return 'Mastercard';
    if (p4.startsWith('62')) return 'UnionPay';
    return 'Bank';
  }
}
