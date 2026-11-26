import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../common/utils/district-scope.util';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { User } from '../users/user.entity';
import { Application, SuspectTreeNode } from './application.entity';
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
  citizen_name: string;
  citizen_phone?: string | null;
  role_in_that_app?: string;
  transfer_amount: number | null;
  currency: string;
  payment_provider?: string | null;
  description: string | null;
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
  role: 'MULE_DROPPER' | 'TRANSIT' | 'VICTIM_SOURCE';
  isBlacklisted: boolean;
  isUnknownDestination?: boolean;
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
          };
        }
        return;
      }

      const params: unknown[] = [itemIds];
      const districtClause =
        allowedDistrictIds && allowedDistrictIds.length > 0
          ? (() => {
              params.push(allowedDistrictIds);
              return `AND a2.district_id = ANY($${params.length}::uuid[])`;
            })()
          : '';

      const rows: Array<{
        app_id: string;
        total_count: number;
        cards_count: number;
        citizens_count: number;
        suspects_count: number;
        has_fraud_link: boolean;
      }> = await this.applicationRepo.manager.query(
        `SELECT
           l1.application_id AS app_id,
           COUNT(DISTINCT l2.application_id)::int AS total_count,
           COUNT(DISTINCT CASE WHEN l1.card_id IS NOT NULL AND l1.card_id = l2.card_id THEN l2.application_id END)::int AS cards_count,
           COUNT(DISTINCT CASE WHEN l1.citizen_id IS NOT NULL AND l1.citizen_id = l2.citizen_id THEN l2.application_id END)::int AS citizens_count,
           COUNT(DISTINCT CASE WHEN (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id) OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id) THEN l2.application_id END)::int AS suspects_count,
           COALESCE(BOOL_OR(
             (l1.card_id IS NOT NULL AND l1.card_id = l2.card_id AND l1.role IN ('DROPPER', 'SUSPECT') AND l2.role IN ('DROPPER', 'SUSPECT'))
             OR (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id AND l1.role = 'SUSPECT' AND l2.role = 'SUSPECT')
             OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id)
           ), false) AS has_fraud_link
         FROM entity_application_links l1
         INNER JOIN entity_application_links l2
           ON l2.application_id <> l1.application_id
          AND (
            (l1.card_id IS NOT NULL AND l1.card_id = l2.card_id)
            OR (l1.citizen_id IS NOT NULL AND l1.citizen_id = l2.citizen_id)
            OR (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id)
            OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id)
          )
         INNER JOIN applications a2
           ON a2.id = l2.application_id
          AND a2.is_deleted = false
          ${districtClause}
         WHERE l1.application_id = ANY($1::uuid[])
         GROUP BY l1.application_id`,
        params,
      );

      const summaryMap = new Map(rows.map((r) => [r.app_id, r]));
      for (const item of items) {
        const s = summaryMap.get(item.id);
        item.relations_summary = {
          total: Number(s?.total_count || 0),
          cards: Number(s?.cards_count || 0),
          citizens: Number(s?.citizens_count || 0),
          suspects: Number(s?.suspects_count || 0),
          has_fraud_card_link: Boolean(s?.has_fraud_link),
        };
      }
    } catch (err) {
      this.logger.warn(
        `attachRelationsSummaries xatolik: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Tanlangan arizaning barcha boshqa arizalar bilan bog'liqliklari (Karta va Fuqaro bo'yicha)
   */
  async getRelations(currentApp: Application, currentUser?: JwtAccessPayload) {
    const id = currentApp.id;

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

    // Nomzod bog'liq arizalarni butun bazani yuklamasdan, indeksli SQL orqali topamiz
    const curCardIds = Array.from(cardData.cardMap.keys());
    const curCitizenIds = Array.from(citizenData.citizenMap.keys());
    const curPinfls = Array.from(citizenData.citizenMap.values())
      .map((c) => c.pinfl?.trim())
      .filter((v): v is string => Boolean(v));
    const curPassports = Array.from(citizenData.citizenMap.values())
      .map((c) => c.passport?.trim().toUpperCase())
      .filter((v): v is string => Boolean(v));
    const curPhones = Array.from(citizenData.citizenMap.values())
      .map((c) => (c.phone_number || '').replace(/\D/g, ''))
      .filter((v) => v.length >= 7);
    const currentSuspectTokens = this.extractSuspectTokens(currentApp);
    const curSuspectLikePatterns = Array.from(
      new Set(
        currentSuspectTokens
          .map((t) => t.normalized.trim().toLowerCase())
          .filter((v) => v.length >= 4)
          .slice(0, 20)
          .map((v) => `%${v.replace(/[%_\\]/g, '\\$&')}%`),
      ),
    );

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
              AND (
                (l1.card_id IS NOT NULL AND l1.card_id = l2.card_id)
                OR (l1.citizen_id IS NOT NULL AND l1.citizen_id = l2.citizen_id)
                OR (l1.phone_id IS NOT NULL AND l1.phone_id = l2.phone_id)
                OR (l1.identifier_id IS NOT NULL AND l1.identifier_id = l2.identifier_id)
              )
             WHERE l1.application_id = $1::uuid
           )
           OR (cardinality($2::uuid[]) > 0 AND (
             a2.card_id = ANY($2::uuid[])
             OR t2.sender_card_id = ANY($2::uuid[])
             OR t2.receiver_card_id = ANY($2::uuid[])
           ))
           OR (cardinality($3::uuid[]) > 0 AND a2.citizen_id = ANY($3::uuid[]))
           OR (cardinality($4::text[]) > 0 AND c2.pinfl = ANY($4::text[]))
           OR (cardinality($5::text[]) > 0 AND UPPER(c2.passport) = ANY($5::text[]))
           OR (cardinality($6::text[]) > 0 AND REGEXP_REPLACE(COALESCE(c2.phone_number, ''), '[^0-9]', '', 'g') = ANY($6::text[]))
           OR (cardinality($7::text[]) > 0 AND a2.suspect_tree IS NOT NULL AND LOWER(a2.suspect_tree::text) LIKE ANY($7::text[]))
         )
       LIMIT 200`,
      [id, curCardIds, curCitizenIds, curPinfls, curPassports, curPhones, curSuspectLikePatterns],
    );

    const candidateIds = candidateRows.map((r) => r.app_id);

    const otherApps =
      candidateIds.length > 0
        ? await this.applicationRepo.find({
            where: { id: In(candidateIds), is_deleted: false },
            relations: {
              application_status: true,
              citizen: { district: true, neighborhood: true },
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
                citizen: { district: true, neighborhood: true },
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
          })
        : [];

    const extraTransfers =
      candidateIds.length > 0
        ? await this.transferRepo.find({
            where: { application_id: In(candidateIds) },
            relations: {
              payment_provider: true,
              sender_card: { bank: true },
              receiver_card: { bank: true },
              card: { bank: true },
              custom_fields: { card: { bank: true }, citizen: true },
            },
          })
        : [];
    const transferByAppId = new Map<string, Transfer>();
    for (const t of extraTransfers) {
      if (t.application_id && !transferByAppId.has(t.application_id)) {
        transferByAppId.set(t.application_id, t);
      }
    }

    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    const isRestrictedOtherApp = (other: Application): boolean =>
      allowedDistrictIds !== null &&
      (!other.district_id || !allowedDistrictIds.includes(other.district_id));

    for (const other of otherApps) {
      if (!other.transfer && transferByAppId.has(other.id)) {
        other.transfer = transferByAppId.get(other.id)!;
      }
    }

    const cardRelationsMap = new Map<
      string,
      {
        card: CardRelationSummary;
        role_in_current_app: 'RECEIVER' | 'SENDER' | 'RELATED';
        linked_applications: LinkedApplicationSummary[];
      }
    >();

    const citizenRelationsMap = new Map<
      string,
      {
        citizen: CitizenRelationSummary;
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
                citizen_id: currentCard.citizen?.id || currentCard.citizen_id || null,
                citizen_name: currentCard.citizen?.full_name?.trim() || null,
              },
              role_in_current_app: currentCardEntry.role,
              linked_applications: [],
            });
          }

          const cardRel = cardRelationsMap.get(cardId)!;
          if (!cardRel.linked_applications.some((a) => a.id === other.id)) {
            const restricted = isRestrictedOtherApp(other);
            cardRel.linked_applications.push({
              id: other.id,
              application_number: restricted
                ? 'Boshqa tuman arizasi'
                : other.application_number || 'Raqamsiz',
              status: other.status,
              status_label: other.application_status?.name || other.status || 'Yangi',
              status_color: other.application_status?.color || 'blue',
              date: other.date,
              citizen_name: restricted
                ? 'Boshqa tuman fuqarosi'
                : other.citizen?.full_name?.trim() || 'Arizachi kiritilmagan',
              citizen_phone: restricted ? null : other.citizen?.phone_number || null,
              role_in_that_app: otherRole,
              transfer_amount: other.transfer?.amount ? Number(other.transfer.amount) : null,
              currency: other.transfer?.currency || 'UZS',
              payment_provider: other.transfer?.payment_provider?.name || null,
              description: restricted
                ? 'Boshqa tuman yurituvidagi ariza'
                : other.description || null,
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
                full_name: currentCitizen.full_name,
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
            const restricted = isRestrictedOtherApp(other);
            citRel.linked_applications.push({
              id: other.id,
              application_number: restricted
                ? 'Boshqa tuman arizasi'
                : other.application_number || 'Raqamsiz',
              status: other.status,
              status_label: other.application_status?.name || other.status || 'Yangi',
              status_color: other.application_status?.color || 'blue',
              date: other.date,
              citizen_name: restricted
                ? 'Boshqa tuman fuqarosi'
                : other.citizen?.full_name?.trim() || 'Arizachi kiritilmagan',
              transfer_amount: other.transfer?.amount ? Number(other.transfer.amount) : null,
              currency: other.transfer?.currency || 'UZS',
              description: restricted
                ? 'Boshqa tuman yurituvidagi ariza'
                : other.description || null,
            });
          }
        }
      }

      // 3. FIRIBGAR / GUMONLANUVCHI DARAXTI (SUSPECT TREE) BO'YICHA TEKSHIRUV
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
              const restricted = isRestrictedOtherApp(other);
              sRel.linked_applications.push({
                id: other.id,
                application_number: restricted
                  ? 'Boshqa tuman arizasi'
                  : other.application_number || 'Raqamsiz',
                status: other.status,
                status_label: other.application_status?.name || other.status || 'Yangi',
                status_color: other.application_status?.color || 'blue',
                date: other.date,
                citizen_name: restricted
                  ? 'Boshqa tuman fuqarosi'
                  : other.citizen?.full_name?.trim() || 'Arizachi kiritilmagan',
                transfer_amount: other.transfer?.amount ? Number(other.transfer.amount) : null,
                currency: other.transfer?.currency || 'UZS',
                description: restricted
                  ? 'Boshqa tuman yurituvidagi ariza'
                  : other.description || null,
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

        const restricted = appContext.id !== currentApp.id && isRestrictedOtherApp(appContext);
        node.linkedApplications.push({
          id: appContext.id,
          application_number: restricted
            ? 'Boshqa tuman arizasi'
            : appContext.application_number || 'Raqamsiz',
          status: appContext.status,
          status_label: appContext.application_status?.name || appContext.status || 'Yangi',
          status_color: appContext.application_status?.color || 'blue',
          date: appContext.date,
          citizen_name: restricted
            ? 'Boshqa tuman fuqarosi'
            : appContext.citizen?.full_name?.trim() || 'Arizachi kiritilmagan',
          citizen_phone: restricted ? null : appContext.citizen?.phone_number || null,
          role_in_that_app: defaultRole,
          transfer_amount: appContext.transfer?.amount ? Number(appContext.transfer.amount) : null,
          currency: appContext.transfer?.currency || 'UZS',
          payment_provider: appContext.transfer?.payment_provider?.name || null,
          description: restricted
            ? 'Boshqa tuman yurituvidagi ariza'
            : appContext.description || null,
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
            totalOut: amt,
            netFlow: -amt,
            inDegree: 0,
            outDegree: 1,
            reportsCount: 1,
            reportIds: [appItem.id],
            riskScore: 10,
            role: 'VICTIM_SOURCE',
            isBlacklisted: false,
            ownerName: citLabel,
            pinfl: restricted ? '' : appItem.citizen.pinfl || '',
            passport: restricted ? '' : appItem.citizen.passport || '',
            phone: restricted ? '' : appItem.citizen.phone_number || '',
            linkedApplications: [
              {
                id: appItem.id,
                application_number: restricted
                  ? 'Boshqa tuman arizasi'
                  : appItem.application_number || 'Raqamsiz',
                status: appItem.status,
                status_label: appItem.application_status?.name || appItem.status || 'Yangi',
                status_color: appItem.application_status?.color || 'blue',
                date: appItem.date,
                citizen_name: citLabel,
                citizen_phone: restricted ? null : appItem.citizen?.phone_number || null,
                role_in_that_app: 'VICTIM_SOURCE',
                transfer_amount: amt,
                currency: tr.currency || 'UZS',
                payment_provider: providerName,
                description: restricted
                  ? 'Boshqa tuman yurituvidagi ariza'
                  : appItem.description || null,
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
                application_number: restricted
                  ? 'Boshqa tuman arizasi'
                  : appItem.application_number || 'Raqamsiz',
                status: appItem.status,
                status_label: appItem.application_status?.name || appItem.status || 'Yangi',
                status_color: appItem.application_status?.color || 'blue',
                date: appItem.date,
                citizen_name: restricted
                  ? 'Boshqa tuman fuqarosi'
                  : appItem.citizen?.full_name?.trim() || 'Arizachi',
                citizen_phone: restricted ? null : appItem.citizen?.phone_number || null,
                role_in_that_app: 'MULE_DROPPER',
                transfer_amount: amt,
                currency: tr.currency || 'UZS',
                payment_provider: providerName,
                description: restricted
                  ? 'Boshqa tuman yurituvidagi ariza'
                  : appItem.description || null,
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
          applicationNumber: restricted
            ? 'Boshqa tuman arizasi'
            : appItem.application_number || 'Raqamsiz',
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

    const currentTransfersMap = new Map<string, Transfer>();
    if (currentApp.transfer?.id) {
      currentTransfersMap.set(currentApp.transfer.id, currentApp.transfer);
    }
    if (currentApp.custom_fields) {
      for (const cf of currentApp.custom_fields) {
        if (cf.transfer?.id && !currentTransfersMap.has(cf.transfer.id)) {
          currentTransfersMap.set(cf.transfer.id, cf.transfer);
        }
      }
    }

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
        transfers: Array.from(currentTransfersMap.values()),
        suspect_tree: currentApp.suspect_tree || [],
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
