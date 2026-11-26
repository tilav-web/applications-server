import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { getAllowedDistrictIds } from '../../common/utils/district-scope.util';
import { Application } from '../applications/application.entity';
import { Bank } from '../applications/transfers/banks/bank.entity';
import { Card } from '../applications/transfers/cards/card.entity';
import { Transfer } from '../applications/transfers/transfer.entity';
import { User } from '../users/user.entity';

export type GraphCardRole =
  | 'MULE_DROPPER'
  | 'TRANSIT'
  | 'VICTIM_SOURCE'
  | 'COMPROMISED_VICTIM'
  | 'ATM_TERMINAL'
  | 'CRYPTO_CASHOUT'
  | 'PLATFORM_CASHOUT'
  | 'BANK_ACCOUNT_OUT';

export interface LinkedApplicationInfo {
  id: string;
  application_number: string;
  status: string | null;
  status_label: string;
  status_color: string;
  date: string | null;
  citizen_name: string;
  citizen_phone?: string | null;
  role_in_that_app?: 'RECEIVER' | 'SENDER' | 'RELATED';
  transfer_amount?: number | null;
  currency?: string;
  payment_provider?: string | null;
  description?: string | null;
}

export interface IGraphNode {
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
  role: GraphCardRole;
  isBlacklisted: boolean;
  isUnknownDestination?: boolean;
  ownerName?: string;
  pinfl?: string;
  passport?: string;
  phone?: string;
  destinationType?: string;
  identifierId?: string;
  linkedApplications?: LinkedApplicationInfo[];
}

export interface IGraphEdge {
  id: string;
  from: string;
  to: string;
  amount: number;
  paymentProvider?: string;
  transactionsCount: number;
  lastDate: string;
  applicationNumber?: string;
  applicationId?: string;
  isUnknownDestination?: boolean;
}

export interface IGraphSummary {
  totalCards: number;
  totalFlowAmount: number;
  droppersCount: number;
  transitCount: number;
  blacklistedCount: number;
}

export interface IGraphData {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  summary: IGraphSummary;
}

export interface GraphFilterQuery {
  searchCard?: string;
  riskLevel?: string;
  minAmount?: number;
}

@Injectable()
export class FinancialFlowService {
  constructor(
    @InjectRepository(Card)
    private readonly cardRepo: Repository<Card>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(Bank)
    private readonly bankRepo: Repository<Bank>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  public identifyBank(cardNumber: string): string {
    const clean = cardNumber.replace(/\D/g, '');
    const p6 = clean.substring(0, 6);
    const p4 = clean.substring(0, 4);

    // 6-xonali aniq BIN prefikslar birinchi tekshirilishi shart (4-xonali umumiy prefikslardan oldin)
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
    if (p4 === '6262') return 'Agrobank';
    if (p4 === '5300') return 'TBC Bank';
    if (p4 === '4000' || p4 === '4001') return 'Kapitalbank';
    return 'Noma‘lum bank';
  }

  private pickLatestDate(current: string, candidate: string): string {
    if (!candidate) return current;
    if (!current) return candidate;
    const curMs = new Date(current).getTime();
    const candMs = new Date(candidate).getTime();
    if (Number.isNaN(candMs)) return current;
    if (Number.isNaN(curMs)) return candidate;
    return candMs > curMs ? candidate : current;
  }

  private cleanCard(cardStr: string | null | undefined): string {
    if (!cardStr) return '';
    return cardStr.replace(/\D/g, '');
  }

  private formatCard(cardStr: string): string {
    const c = this.cleanCard(cardStr);
    if (c.length === 16) {
      return `${c.slice(0, 4)} ${c.slice(4, 8)} ${c.slice(8, 12)} ${c.slice(12, 16)}`;
    }
    return cardStr;
  }

  /**
   * Butun tizimdagi barcha kartalar va to'lov o'tkazmalari bo'yicha
   * global Canvas Network Graph ma'lumotlarini shakllantirish
   */
  async getNetworkGraph(
    filter: GraphFilterQuery = {},
    currentUser?: JwtAccessPayload,
  ): Promise<IGraphData> {
    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    if (allowedDistrictIds !== null && allowedDistrictIds.length === 0) {
      return {
        nodes: [],
        edges: [],
        summary: {
          totalCards: 0,
          totalFlowAmount: 0,
          droppersCount: 0,
          transitCount: 0,
          blacklistedCount: 0,
        },
      };
    }

    const GRAPH_MAX_ROWS = 500;
    const searchDigits = filter.searchCard ? filter.searchCard.replace(/\D/g, '') : '';
    let searchScopedCardIds: string[] | null = null;
    if (filter.searchCard?.trim()) {
      const qRaw = `%${filter.searchCard.trim()}%`;
      const cardMatchQb = this.cardRepo
        .createQueryBuilder('c')
        .leftJoin('c.bank', 'b')
        .select('c.id')
        .where(
          '(c.card_number ILIKE :qRaw OR c.masked_number ILIKE :qRaw OR c.full_name ILIKE :qRaw OR b.name ILIKE :qRaw)',
          { qRaw },
        )
        .take(200);
      if (searchDigits.length >= 4) {
        cardMatchQb.orWhere('c.card_number ILIKE :qDigits', { qDigits: `%${searchDigits}%` });
      }
      const matchedCards = await cardMatchQb.getMany();
      searchScopedCardIds = matchedCards.map((c) => c.id);
    }

    // 1. Faol arizalarni yuklash (DISTRICT_OFFICER uchun faqat o'z tumanlari, oxirgi 500 ta cheklangan)
    const applications = await this.applicationRepo.find({
      where:
        allowedDistrictIds !== null
          ? { is_deleted: false, district_id: In(allowedDistrictIds) }
          : { is_deleted: false },
      relations: {
        application_status: true,
        citizen: true,
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: { bank: true, citizen: true },
          receiver_card: { bank: true, citizen: true },
        },
      },
      order: { created_at: 'DESC' },
      take: GRAPH_MAX_ROWS,
    });

    const allowedAppIds = applications.map((a) => a.id);

    // 2. O'tkazmalarni yuklash (cheklangan va kerak bo'lsa searchCard bo'yicha SQL filtrlangan)
    let transfers: Transfer[];
    if (allowedDistrictIds !== null) {
      transfers =
        allowedAppIds.length > 0
          ? await this.transferRepo.find({
              where: { application_id: In(allowedAppIds) },
              relations: {
                payment_provider: true,
                sender_card: { bank: true, citizen: true },
                receiver_card: { bank: true, citizen: true },
                receiver_identifier: true,
                card: { bank: true, citizen: true },
                application: { citizen: true, application_status: true },
              },
              order: { created_at: 'DESC' },
              take: GRAPH_MAX_ROWS,
            })
          : [];
    } else if (searchScopedCardIds !== null && searchScopedCardIds.length > 0) {
      transfers = await this.transferRepo.find({
        where: [
          { sender_card_id: In(searchScopedCardIds) },
          { receiver_card_id: In(searchScopedCardIds) },
        ],
        relations: {
          payment_provider: true,
          sender_card: { bank: true, citizen: true },
          receiver_card: { bank: true, citizen: true },
          receiver_identifier: true,
          card: { bank: true, citizen: true },
          application: { citizen: true, application_status: true },
        },
        order: { created_at: 'DESC' },
        take: GRAPH_MAX_ROWS,
      });
    } else {
      transfers = await this.transferRepo.find({
        relations: {
          payment_provider: true,
          sender_card: { bank: true, citizen: true },
          receiver_card: { bank: true, citizen: true },
          receiver_identifier: true,
          card: { bank: true, citizen: true },
          application: { citizen: true, application_status: true },
        },
        order: { created_at: 'DESC' },
        take: GRAPH_MAX_ROWS,
      });
    }

    // 3. Kartalarni yuklash (faqat grafda ishtirok etuvchi yoki qidiruvga mos kartalar)
    const scopedCardIds = new Set<string>(searchScopedCardIds || []);
    for (const app of applications) {
      if (app.card_id) scopedCardIds.add(app.card_id);
      if (app.transfer?.sender_card_id) scopedCardIds.add(app.transfer.sender_card_id);
      if (app.transfer?.receiver_card_id) scopedCardIds.add(app.transfer.receiver_card_id);
    }
    for (const tr of transfers) {
      if (tr.sender_card_id) scopedCardIds.add(tr.sender_card_id);
      if (tr.receiver_card_id) scopedCardIds.add(tr.receiver_card_id);
      if (tr.card_id) scopedCardIds.add(tr.card_id);
    }

    const allCards: Card[] =
      scopedCardIds.size > 0
        ? await this.cardRepo.find({
            where: { id: In(Array.from(scopedCardIds)) },
            relations: { bank: true, citizen: true },
            order: { created_at: 'DESC' },
            take: GRAPH_MAX_ROWS,
          })
        : [];

    const nodeMap = new Map<string, IGraphNode>();
    const edgeMap = new Map<string, IGraphEdge>();

    // Yordamchi: Kartani ro'yxatdan o'tkazish yoki mavjudini olish
    const getOrCreateNode = (
      cardObj: Card | null | undefined,
      rawNum: string | null | undefined,
      defaultRole: GraphCardRole = 'TRANSIT',
    ): IGraphNode | null => {
      const cleanNum = this.cleanCard(rawNum || cardObj?.card_number || cardObj?.masked_number);
      if (!cleanNum) return null;

      if (!nodeMap.has(cleanNum)) {
        const bankName = cardObj?.bank?.name || this.identifyBank(cleanNum);
        const ownerName = cardObj?.full_name || cardObj?.citizen?.full_name?.trim() || undefined;

        nodeMap.set(cleanNum, {
          id: cardObj?.id || cleanNum,
          cardNumber: cleanNum,
          maskedCard: this.formatCard(cleanNum),
          bankName,
          totalIn: 0,
          totalOut: 0,
          netFlow: 0,
          inDegree: 0,
          outDegree: 0,
          reportsCount: 0,
          reportIds: [],
          riskScore: 20,
          role: defaultRole,
          isBlacklisted: false,
          ownerName: ownerName || undefined,
          phone: cardObj?.citizen?.phone_number || undefined,
          passport: cardObj?.citizen?.passport || undefined,
          pinfl: cardObj?.citizen?.pinfl || undefined,
          linkedApplications: [],
        });
      }

      const node = nodeMap.get(cleanNum)!;
      if (cardObj?.bank?.name && (!node.bankName || node.bankName === 'Noma‘lum bank')) {
        node.bankName = cardObj.bank.name;
      }
      if (cardObj?.full_name && !node.ownerName) {
        node.ownerName = cardObj.full_name;
      }
      return node;
    };

    // Barcha mavjud kartalarni tugun qilib qo'shish
    for (const c of allCards) {
      getOrCreateNode(c, c.card_number, 'TRANSIT');
    }

    // 4. O'tkazmalar bo'yicha bog'liqliklar va yo'nalishlar (Edges) tuzish
    const activeTransfers = transfers.filter((tr) => !tr.application?.is_deleted);
    const hasUzsFlow = activeTransfers.some(
      (tr) => (!tr.currency || tr.currency.toUpperCase() === 'UZS') && Number(tr.amount) > 0,
    );

    for (const tr of activeTransfers) {
      const senderCard = tr.sender_card;
      const receiverCard = tr.receiver_card;
      const rawAmount = Number(tr.amount) || 0;
      const curr = (tr.currency || 'UZS').toUpperCase();
      const amount = !hasUzsFlow || curr === 'UZS' ? rawAmount : 0;
      const dateStr = tr.transfer_date || tr.created_at?.toISOString() || '';
      const providerName = tr.payment_provider?.name || 'To‘lov tizimi';

      const sClean = senderCard ? this.cleanCard(senderCard.card_number) : '';
      const rClean = receiverCard ? this.cleanCard(receiverCard.card_number) : '';
      const destType = tr.destination_type || TransferDestinationType.CARD;

      if (destType !== TransferDestinationType.CARD && sClean) {
        const fromNode = getOrCreateNode(senderCard, sClean, 'VICTIM_SOURCE');
        const ident = tr.receiver_identifier;
        const details = (tr.destination_details || {}) as Record<string, string | undefined>;
        const displayLabel =
          tr.destination_label ||
          (ident ? `${ident.type_label || ident.type}: ${ident.raw_value}` : null) ||
          details.value ||
          details.platform ||
          (destType === TransferDestinationType.CASH
            ? 'Naqdlashtirish (ATM)'
            : destType === TransferDestinationType.CRYPTO
              ? 'Kripto-birja / Hamyon'
              : destType === TransferDestinationType.PLATFORM
                ? 'Onlayn servis'
                : 'Boshqa chiqish');

        const destKey = ident
          ? `ident__${ident.id}`
          : `dest__${destType}__${displayLabel.toLowerCase().trim()}`;

        const destRole: GraphCardRole =
          destType === TransferDestinationType.CRYPTO
            ? 'CRYPTO_CASHOUT'
            : destType === TransferDestinationType.CASH
              ? 'ATM_TERMINAL'
              : destType === TransferDestinationType.BANK_ACCOUNT
                ? 'BANK_ACCOUNT_OUT'
                : 'PLATFORM_CASHOUT';

        const subLabel =
          details.platform ||
          ident?.type_label ||
          (destType === TransferDestinationType.CRYPTO
            ? 'Kripto / Birja'
            : destType === TransferDestinationType.CASH
              ? 'Naqdlashtirish (ATM)'
              : destType === TransferDestinationType.BANK_ACCOUNT
                ? 'Bank hisob raqami'
                : 'Onlayn tizim / Profil');

        if (!nodeMap.has(destKey)) {
          nodeMap.set(destKey, {
            id: destKey,
            cardNumber: displayLabel,
            maskedCard: displayLabel,
            bankName: subLabel,
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

        const toNode = nodeMap.get(destKey)!;
        if (fromNode && toNode) {
          fromNode.totalOut += amount;
          fromNode.outDegree += 1;
          toNode.totalIn += amount;
          toNode.inDegree += 1;

          const edgeKey = `${sClean}__${destKey}`;
          if (edgeMap.has(edgeKey)) {
            const existingEdge = edgeMap.get(edgeKey)!;
            existingEdge.amount += amount;
            existingEdge.transactionsCount += 1;
            existingEdge.lastDate = this.pickLatestDate(existingEdge.lastDate, dateStr);
          } else {
            edgeMap.set(edgeKey, {
              id: tr.id || edgeKey,
              from: fromNode.id,
              to: toNode.id,
              amount,
              paymentProvider: details.platform || providerName,
              transactionsCount: 1,
              lastDate: dateStr,
              applicationId: tr.application_id || undefined,
            });
          }
        }
      } else if (sClean && rClean && sClean !== rClean) {
        const fromNode = getOrCreateNode(senderCard, sClean, 'VICTIM_SOURCE');
        const toNode = getOrCreateNode(receiverCard, rClean, 'MULE_DROPPER');

        if (fromNode && toNode) {
          fromNode.totalOut += amount;
          fromNode.outDegree += 1;
          toNode.totalIn += amount;
          toNode.inDegree += 1;

          const edgeKey = `${sClean}__${rClean}`;
          if (edgeMap.has(edgeKey)) {
            const existingEdge = edgeMap.get(edgeKey)!;
            existingEdge.amount += amount;
            existingEdge.transactionsCount += 1;
            existingEdge.lastDate = this.pickLatestDate(existingEdge.lastDate, dateStr);
          } else {
            edgeMap.set(edgeKey, {
              id: tr.id || edgeKey,
              from: fromNode.id,
              to: toNode.id,
              amount,
              paymentProvider: providerName,
              transactionsCount: 1,
              lastDate: dateStr,
              applicationId: tr.application_id || undefined,
            });
          }
        }
      }
    }

    // 5. Arizalarni ko'rib chiqish va arizalarga tegishli o'tkazmalarni kiritish
    for (const app of applications) {
      const appNumber = app.application_number || 'Raqamsiz';
      const rawDate = app.date || app.created_at;
      const appDate: string | null = rawDate
        ? typeof rawDate === 'string'
          ? rawDate
          : rawDate.toISOString()
        : null;
      const citizenName = app.citizen?.full_name?.trim() || 'Noma‘lum fuqaro';
      const citizenPhone = app.citizen?.phone_number || null;
      const statusLabel = app.application_status?.name || app.status || 'YANGI';
      const statusColor = app.application_status?.color || '#3b82f6';

      // 5.1 Asosiy transfer
      const tr = app.transfer;
      if (tr) {
        const sClean = tr.sender_card ? this.cleanCard(tr.sender_card.card_number) : '';
        const rClean = tr.receiver_card ? this.cleanCard(tr.receiver_card.card_number) : '';
        const amount = Number(tr.amount) || 0;
        const providerName = tr.payment_provider?.name || 'To‘lov tizimi';

        // Qabul qiluvchi karta
        if (rClean) {
          const rNode = getOrCreateNode(tr.receiver_card, rClean, 'MULE_DROPPER');
          if (rNode) {
            if (!rNode.reportIds.includes(app.id)) {
              rNode.reportIds.push(app.id);
              rNode.reportsCount += 1;
            }
            // Bog'langan ariza sifatida yozish
            const alreadyLinked = rNode.linkedApplications?.some((la) => la.id === app.id);
            if (!alreadyLinked) {
              rNode.linkedApplications?.push({
                id: app.id,
                application_number: appNumber,
                status: app.status,
                status_label: statusLabel,
                status_color: statusColor,
                date: appDate,
                citizen_name: citizenName,
                citizen_phone: citizenPhone,
                role_in_that_app: 'RECEIVER',
                transfer_amount: amount,
                payment_provider: providerName,
                description: app.description,
              });
            }
          }
        }

        // Jo'natuvchi karta
        if (sClean) {
          const sNode = getOrCreateNode(tr.sender_card, sClean, 'VICTIM_SOURCE');
          if (sNode) {
            if (!sNode.reportIds.includes(app.id)) {
              sNode.reportIds.push(app.id);
              sNode.reportsCount += 1;
            }
            const alreadyLinked = sNode.linkedApplications?.some((la) => la.id === app.id);
            if (!alreadyLinked) {
              sNode.linkedApplications?.push({
                id: app.id,
                application_number: appNumber,
                status: app.status,
                status_label: statusLabel,
                status_color: statusColor,
                date: appDate,
                citizen_name: citizenName,
                citizen_phone: citizenPhone,
                role_in_that_app: 'SENDER',
                transfer_amount: amount,
                payment_provider: providerName,
                description: app.description,
              });
            }
          }
        }

        // Agar jo'natuvchi karta bo'lmay, faqat arizachi bo'lsa va qabul qiluvchi bo'lsa
        if (!sClean && rClean && app.citizen) {
          const citKey = `cit__${app.citizen.id}`;
          const trCurr = (tr.currency || 'UZS').toUpperCase();
          const flowAmount = !hasUzsFlow || trCurr === 'UZS' ? amount : 0;
          if (!nodeMap.has(citKey)) {
            nodeMap.set(citKey, {
              id: citKey,
              cardNumber: app.citizen.full_name?.trim() || 'Arizachi',
              maskedCard: citizenName,
              bankName: `Ariza № ${appNumber}`,
              totalIn: 0,
              totalOut: 0,
              netFlow: 0,
              inDegree: 0,
              outDegree: 0,
              reportsCount: 0,
              reportIds: [],
              riskScore: 10,
              role: 'VICTIM_SOURCE',
              isBlacklisted: false,
              ownerName: citizenName,
              phone: citizenPhone || undefined,
              passport: app.citizen.passport || undefined,
              pinfl: app.citizen.pinfl || undefined,
              linkedApplications: [],
            });
          }
          const citNode = nodeMap.get(citKey)!;
          citNode.totalOut += flowAmount;
          citNode.outDegree += 1;
          if (!citNode.reportIds.includes(app.id)) {
            citNode.reportIds.push(app.id);
            citNode.reportsCount += 1;
            citNode.linkedApplications?.push({
              id: app.id,
              application_number: appNumber,
              status: app.status,
              status_label: statusLabel,
              status_color: statusColor,
              date: appDate,
              citizen_name: citizenName,
              citizen_phone: citizenPhone,
              role_in_that_app: 'SENDER',
              transfer_amount: amount,
              currency: trCurr,
              payment_provider: providerName,
              description: app.description,
            });
          }
          const rNode = nodeMap.get(rClean);
          if (rNode) {
            rNode.totalIn += flowAmount;
            rNode.inDegree += 1;
            const edgeKey = `${citKey}__${rClean}`;
            if (edgeMap.has(edgeKey)) {
              const existingEdge = edgeMap.get(edgeKey)!;
              existingEdge.amount += flowAmount;
              existingEdge.transactionsCount += 1;
              existingEdge.lastDate = this.pickLatestDate(existingEdge.lastDate, appDate || '');
            } else {
              edgeMap.set(edgeKey, {
                id: `edge_${app.id}`,
                from: citNode.id,
                to: rNode.id,
                amount: flowAmount,
                paymentProvider: providerName,
                transactionsCount: 1,
                lastDate: appDate || '',
                applicationId: app.id,
                applicationNumber: appNumber,
              });
            }
          }
        }
      }

      // 5.2 Arizaning to'g'ridan-to'g'ri biriktirilgan kartasi (app.card)
      if (app.card) {
        const cClean = this.cleanCard(app.card.card_number);
        if (cClean) {
          const cNode = getOrCreateNode(app.card, cClean, 'VICTIM_SOURCE');
          if (cNode && !cNode.reportIds.includes(app.id)) {
            cNode.reportIds.push(app.id);
            cNode.reportsCount += 1;
            cNode.linkedApplications?.push({
              id: app.id,
              application_number: appNumber,
              status: app.status,
              status_label: statusLabel,
              status_color: statusColor,
              date: appDate,
              citizen_name: citizenName,
              citizen_phone: citizenPhone,
              role_in_that_app: 'RELATED',
              description: app.description,
            });
          }
        }
      }
    }

    // 6. Rollar va Risk Ballarini hisoblash
    const specialExitRoles = new Set<GraphCardRole>([
      'ATM_TERMINAL',
      'CRYPTO_CASHOUT',
      'PLATFORM_CASHOUT',
      'BANK_ACCOUNT_OUT',
    ]);

    for (const node of nodeMap.values()) {
      node.netFlow = node.totalIn - node.totalOut;

      if (specialExitRoles.has(node.role)) {
        node.riskScore = Math.min(95, 70 + node.inDegree * 8);
      } else if (node.inDegree > 0 && node.outDegree === 0) {
        node.role = 'MULE_DROPPER';
        node.riskScore = Math.min(95, 60 + node.inDegree * 10 + (node.reportsCount > 1 ? 20 : 0));
      } else if (node.inDegree > 0 && node.outDegree > 0) {
        node.role = 'TRANSIT';
        node.riskScore = Math.min(85, 40 + (node.inDegree + node.outDegree) * 5);
      } else {
        node.role = 'VICTIM_SOURCE';
        node.riskScore = 15;
      }
    }

    // 7. Filtrlash
    let nodes = Array.from(nodeMap.values());
    let edges = Array.from(edgeMap.values());

    // Qidiruv filtri
    if (filter.searchCard) {
      const q = filter.searchCard.toLowerCase().replace(/\s+/g, '');
      nodes = nodes.filter((n) => {
        const cardMatch = n.cardNumber.toLowerCase().includes(q);
        const ownerMatch = (n.ownerName || '').toLowerCase().includes(q);
        const bankMatch = (n.bankName || '').toLowerCase().includes(q);
        return cardMatch || ownerMatch || bankMatch;
      });
      const validNodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => validNodeIds.has(e.from) && validNodeIds.has(e.to));
    }

    // Minimal summa filtri
    if (filter.minAmount && filter.minAmount > 0) {
      edges = edges.filter((e) => e.amount >= filter.minAmount!);
      const connectedNodeIds = new Set<string>();
      edges.forEach((e) => {
        connectedNodeIds.add(e.from);
        connectedNodeIds.add(e.to);
      });
      nodes = nodes.filter((n) => connectedNodeIds.has(n.id));
    }

    // Xavf darajasi / kanal filtri
    if (filter.riskLevel && filter.riskLevel !== 'ALL') {
      if (filter.riskLevel === 'RED') {
        nodes = nodes.filter((n) => n.role === 'MULE_DROPPER' || n.riskScore >= 70);
      } else if (filter.riskLevel === 'YELLOW') {
        nodes = nodes.filter((n) => n.role === 'TRANSIT');
      } else if (filter.riskLevel === 'BLUE') {
        nodes = nodes.filter((n) => n.role === 'VICTIM_SOURCE');
      } else if (filter.riskLevel === 'CRYPTO') {
        nodes = nodes.filter((n) => n.role === 'CRYPTO_CASHOUT');
      } else if (filter.riskLevel === 'CASH') {
        nodes = nodes.filter((n) => n.role === 'ATM_TERMINAL');
      } else if (filter.riskLevel === 'PLATFORM') {
        nodes = nodes.filter((n) => n.role === 'PLATFORM_CASHOUT' || n.role === 'BANK_ACCOUNT_OUT');
      }
      const validNodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => validNodeIds.has(e.from) && validNodeIds.has(e.to));
    }

    const totalFlowAmount = edges.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const filteredDroppers = nodes.filter(
      (n) => n.role === 'MULE_DROPPER' || specialExitRoles.has(n.role),
    ).length;
    const filteredTransit = nodes.filter((n) => n.role === 'TRANSIT').length;
    const filteredBlacklisted = nodes.filter((n) => n.riskScore >= 75).length;

    return {
      nodes,
      edges,
      summary: {
        totalCards: nodes.length,
        totalFlowAmount,
        droppersCount: filteredDroppers,
        transitCount: filteredTransit,
        blacklistedCount: filteredBlacklisted,
      },
    };
  }

  /**
   * Karta bo'yicha batafsil ma'lumot olish (butun global grafni qurmasdan, to'g'ridan-to'g'ri SQL orqali)
   */
  async getCardDetails(cardNumber: string, currentUser?: JwtAccessPayload) {
    const cleanNum = this.cleanCard(cardNumber);
    if (!cleanNum) {
      return { card: null, node: undefined, linkedApplications: [] };
    }

    const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    if (allowedDistrictIds !== null && allowedDistrictIds.length === 0) {
      return { card: null, node: undefined, linkedApplications: [] };
    }

    const card = await this.cardRepo.findOne({
      where: [{ card_number: cleanNum }, { masked_number: cleanNum }],
      relations: { bank: true, citizen: true },
    });

    if (!card) {
      return { card: null, node: undefined, linkedApplications: [] };
    }

    const cardTransfers = await this.transferRepo.find({
      where: [{ sender_card_id: card.id }, { receiver_card_id: card.id }, { card_id: card.id }],
      relations: {
        payment_provider: true,
        application: { citizen: true, application_status: true },
      },
      order: { created_at: 'DESC' },
    });

    const directAppsQb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .leftJoinAndSelect('app.application_status', 'application_status')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .leftJoinAndSelect('transfer.payment_provider', 'payment_provider')
      .where('app.is_deleted = false')
      .andWhere(
        `(app.card_id = :cardId OR transfer.sender_card_id = :cardId OR transfer.receiver_card_id = :cardId OR EXISTS (SELECT 1 FROM transfers t WHERE t.application_id = app.id AND (t.sender_card_id = :cardId OR t.receiver_card_id = :cardId OR t.card_id = :cardId)))`,
        { cardId: card.id },
      );

    if (allowedDistrictIds !== null) {
      directAppsQb.andWhere('app.district_id IN (:...allowedDistrictIds)', { allowedDistrictIds });
    }

    const linkedAppsRaw = await directAppsQb.orderBy('app.created_at', 'DESC').take(200).getMany();

    if (allowedDistrictIds !== null && linkedAppsRaw.length === 0) {
      const citizenDistrictAllowed = Boolean(
        card.citizen?.district_id && allowedDistrictIds.includes(card.citizen.district_id),
      );
      if (!citizenDistrictAllowed) {
        return { card: null, node: undefined, linkedApplications: [] };
      }
    }

    const allowedAppSet = new Set(linkedAppsRaw.map((a) => a.id));
    let totalIn = 0;
    let totalOut = 0;
    let inDegree = 0;
    let outDegree = 0;

    for (const tr of cardTransfers) {
      if (tr.application?.is_deleted) continue;
      if (
        allowedDistrictIds !== null &&
        tr.application_id &&
        !allowedAppSet.has(tr.application_id)
      ) {
        continue;
      }
      const amt = Number(tr.amount) || 0;
      const isUzs = !tr.currency || tr.currency.toUpperCase() === 'UZS';
      if (tr.receiver_card_id === card.id) {
        inDegree += 1;
        if (isUzs) totalIn += amt;
      }
      if (tr.sender_card_id === card.id) {
        outDegree += 1;
        if (isUzs) totalOut += amt;
      }
    }

    const linkedApplications: LinkedApplicationInfo[] = linkedAppsRaw.map((app) => {
      const roleInApp: 'RECEIVER' | 'SENDER' | 'RELATED' =
        app.transfer?.receiver_card_id === card.id
          ? 'RECEIVER'
          : app.transfer?.sender_card_id === card.id
            ? 'SENDER'
            : 'RELATED';
      const rawDate = app.date || app.created_at;
      return {
        id: app.id,
        application_number: app.application_number || 'Raqamsiz',
        status: app.status,
        status_label: app.application_status?.name || app.status || 'YANGI',
        status_color: app.application_status?.color || '#3b82f6',
        date: rawDate ? (typeof rawDate === 'string' ? rawDate : rawDate.toISOString()) : null,
        citizen_name: app.citizen?.full_name?.trim() || 'Noma‘lum fuqaro',
        citizen_phone: app.citizen?.phone_number || null,
        role_in_that_app: roleInApp,
        transfer_amount: app.transfer?.amount ? Number(app.transfer.amount) : null,
        currency: app.transfer?.currency || 'UZS',
        payment_provider: app.transfer?.payment_provider?.name || null,
        description: app.description,
      };
    });

    let role: GraphCardRole = 'VICTIM_SOURCE';
    let riskScore = 15;
    if (inDegree > 0 && outDegree === 0) {
      role = 'MULE_DROPPER';
      riskScore = Math.min(95, 60 + inDegree * 10 + (linkedApplications.length > 1 ? 20 : 0));
    } else if (inDegree > 0 && outDegree > 0) {
      role = 'TRANSIT';
      riskScore = Math.min(85, 40 + (inDegree + outDegree) * 5);
    }

    const ownerName = card.full_name || card.citizen?.full_name?.trim() || undefined;

    const node: IGraphNode = {
      id: card.id,
      cardNumber: cleanNum,
      maskedCard: this.formatCard(cleanNum),
      bankName: card.bank?.name || this.identifyBank(cleanNum),
      totalIn,
      totalOut,
      netFlow: totalIn - totalOut,
      inDegree,
      outDegree,
      reportsCount: linkedApplications.length,
      reportIds: linkedApplications.map((a) => a.id),
      riskScore,
      role,
      isBlacklisted: riskScore >= 75,
      ownerName: ownerName || undefined,
      phone: card.citizen?.phone_number || undefined,
      passport: card.citizen?.passport || undefined,
      pinfl: card.citizen?.pinfl || undefined,
      linkedApplications,
    };

    return {
      card,
      node,
      linkedApplications,
    };
  }
}
