import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import { Application } from '../applications/application.entity';
import { Bank } from '../applications/transfers/banks/bank.entity';
import { Card } from '../applications/transfers/cards/card.entity';
import { Transfer } from '../applications/transfers/transfer.entity';

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
  ) {}

  public identifyBank(cardNumber: string): string {
    const clean = cardNumber.replace(/\D/g, '');
    const p4 = clean.substring(0, 4);
    const p6 = clean.substring(0, 6);

    if (p4 === '8600') return 'Uzcard';
    if (p4 === '9860') return 'Humo';
    if (p4 === '5614') return 'Uzcard Cobadged';
    if (p4 === '6262') return 'Agrobank';
    if (p4 === '5300') return 'TBC Bank';
    if (p4 === '4000' || p4 === '4001') return 'Kapitalbank';
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
    return 'Noma‘lum bank';
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
  async getNetworkGraph(filter: GraphFilterQuery = {}): Promise<IGraphData> {
    // 1. Barcha arizalarni yuklash
    const applications = await this.applicationRepo.find({
      relations: {
        application_status: true,
        citizen: true,
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: { bank: true, citizen: true },
          receiver_card: { bank: true, citizen: true },
          custom_fields: { bank: true, card: true, citizen: true },
        },
        custom_fields: {
          card: { bank: true, citizen: true },
          transfer: {
            payment_provider: true,
            sender_card: { bank: true, citizen: true },
            receiver_card: { bank: true, citizen: true },
          },
        },
      },
      order: { created_at: 'DESC' },
    });

    // 2. Barcha o'tkazmalarni yuklash
    const transfers = await this.transferRepo.find({
      relations: {
        payment_provider: true,
        sender_card: { bank: true, citizen: true },
        receiver_card: { bank: true, citizen: true },
        receiver_identifier: true,
        card: { bank: true, citizen: true },
        application: { citizen: true, application_status: true },
        custom_fields: true,
      },
      order: { created_at: 'DESC' },
    });

    // 3. Barcha kartalarni yuklash
    const allCards = await this.cardRepo.find({
      relations: {
        bank: true,
        citizen: true,
      },
      order: { created_at: 'DESC' },
    });

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
        const ownerName =
          cardObj?.full_name ||
          (cardObj?.citizen
            ? `${cardObj.citizen.last_name || ''} ${cardObj.citizen.first_name || ''}`.trim()
            : undefined);

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
    for (const tr of transfers) {
      const senderCard = tr.sender_card;
      const receiverCard = tr.receiver_card;
      const amount = Number(tr.amount) || 0;
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
            existingEdge.lastDate = dateStr || existingEdge.lastDate;
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
            existingEdge.lastDate = dateStr || existingEdge.lastDate;
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
      const citizenName = app.citizen
        ? `${app.citizen.last_name || ''} ${app.citizen.first_name || ''}`.trim()
        : 'Noma‘lum fuqaro';
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
          if (!nodeMap.has(citKey)) {
            nodeMap.set(citKey, {
              id: citKey,
              cardNumber:
                `${app.citizen.last_name || ''} ${app.citizen.first_name || ''}`.trim() ||
                'Arizachi',
              maskedCard: citizenName,
              bankName: `Ariza № ${appNumber}`,
              totalIn: 0,
              totalOut: amount,
              netFlow: -amount,
              inDegree: 0,
              outDegree: 1,
              reportsCount: 1,
              reportIds: [app.id],
              riskScore: 10,
              role: 'VICTIM_SOURCE',
              isBlacklisted: false,
              ownerName: citizenName,
              phone: citizenPhone || undefined,
              passport: app.citizen.passport || undefined,
              pinfl: app.citizen.pinfl || undefined,
              linkedApplications: [
                {
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
                },
              ],
            });
          }
          const citNode = nodeMap.get(citKey)!;
          const rNode = nodeMap.get(rClean);
          if (rNode) {
            rNode.totalIn += amount;
            rNode.inDegree += 1;
            const edgeKey = `${citKey}__${rClean}`;
            if (!edgeMap.has(edgeKey)) {
              edgeMap.set(edgeKey, {
                id: `edge_${app.id}`,
                from: citNode.id,
                to: rNode.id,
                amount,
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
    let droppersCount = 0;
    let transitCount = 0;
    let blacklistedCount = 0;

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
        droppersCount++;
      } else if (node.inDegree > 0 && node.outDegree === 0) {
        node.role = 'MULE_DROPPER';
        node.riskScore = Math.min(95, 60 + node.inDegree * 10 + (node.reportsCount > 1 ? 20 : 0));
        droppersCount++;
      } else if (node.inDegree > 0 && node.outDegree > 0) {
        node.role = 'TRANSIT';
        node.riskScore = Math.min(85, 40 + (node.inDegree + node.outDegree) * 5);
        transitCount++;
      } else {
        node.role = 'VICTIM_SOURCE';
        node.riskScore = 15;
      }

      if (node.riskScore >= 75) {
        blacklistedCount++;
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

    return {
      nodes,
      edges,
      summary: {
        totalCards: nodes.length,
        totalFlowAmount,
        droppersCount,
        transitCount,
        blacklistedCount,
      },
    };
  }

  /**
   * Karta bo'yicha batafsil ma'lumot olish
   */
  async getCardDetails(cardNumber: string) {
    const cleanNum = this.cleanCard(cardNumber);
    const card = await this.cardRepo.findOne({
      where: [{ card_number: cleanNum }, { masked_number: cleanNum }],
      relations: { bank: true, citizen: true },
    });

    const graph = await this.getNetworkGraph({ searchCard: cleanNum });
    const node = graph.nodes.find((n) => n.cardNumber === cleanNum);

    return {
      card,
      node,
      linkedApplications: node?.linkedApplications || [],
    };
  }
}
