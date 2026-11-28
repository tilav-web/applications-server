import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, IsNull, Not, Repository } from 'typeorm';

import { ApplicationRepeatType } from '../../common/enums/appeal-classification.enum';
import { Role } from '../../common/enums/role.enum';
import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import { TransferStatus } from '../../common/enums/transfer-status.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { formatTitleCase, formatUzbekName } from '../../common/utils/name-formatter.util';
import {
  escapeLikePattern,
  isPgUniqueViolation,
  normalizePassport,
} from '../../common/utils/normalization.util';
import { Application } from '../applications/application.entity';
import { Citizen } from '../applications/citizens/citizen.entity';
import { Bank } from '../applications/transfers/banks/bank.entity';
import { Card } from '../applications/transfers/cards/card.entity';
import { PaymentProvider } from '../applications/transfers/payment_providers/payment_provider.entity';
import { Transfer } from '../applications/transfers/transfer.entity';
import { DetectedCrime } from '../detected-crimes/entities/detected-crime.entity';
import { DetectedCrimeEvidence } from '../detected-crimes/entities/detected-crime-evidence.entity';
import { DetectedCrimeSuspect } from '../detected-crimes/entities/detected-crime-suspect.entity';
import {
  FinancialFlowService,
  IGraphEdge,
  IGraphNode,
} from '../financial-flow/financial-flow.service';
import { User } from '../users/user.entity';
import { DigitalIdentifierEntity } from './entities/digital-identifier.entity';
import { EntityApplicationLink, EntityLinkRole } from './entities/entity-application-link.entity';
import { PhoneEntity } from './entities/phone.entity';
import type {
  CoOccurringClueItem,
  DetectedCrimeLinkItem,
  DossierApplicationItem,
  DossierMicroStats,
  DossierTransferItem,
  FullDossierResponse,
  GlobalSearchResponse,
  GlobalSearchResultItem,
  INetworkEdge,
  INetworkGraph,
  INetworkNode,
  LiveRadarResponse,
  MultiHopChainItem,
  ProbableMatchItem,
} from './intelligence.types';
import { IntelligenceSyncService } from './intelligence-sync.service';
import {
  formatPhoneDisplay,
  getIdentifierTypeLabel,
  isCardLikeFieldKey,
  isLinkableIdentifierType,
  isPhoneLikeFieldKey,
  normalizeIdentifierValue,
  normalizePhoneDigits,
} from './utils/identifier-normalizer.util';

const FRAUD_LINK_ROLES: ReadonlySet<EntityLinkRole> = new Set(['SUSPECT', 'DROPPER', 'TRANSIT']);

function isFraudLinkRole(role?: string | null): boolean {
  return Boolean(role && FRAUD_LINK_ROLES.has(role as EntityLinkRole));
}

@Injectable()
export class IntelligenceService {
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
    @InjectRepository(PaymentProvider)
    private readonly providerRepo: Repository<PaymentProvider>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(Application)
    private readonly appRepo: Repository<Application>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly syncService: IntelligenceSyncService,
    private readonly financialFlowService: FinancialFlowService,
    @Optional()
    @InjectRepository(DetectedCrime)
    private readonly detectedCrimeRepo?: Repository<DetectedCrime>,
    @Optional()
    @InjectRepository(DetectedCrimeSuspect)
    private readonly detectedCrimeSuspectRepo?: Repository<DetectedCrimeSuspect>,
    @Optional()
    @InjectRepository(DetectedCrimeEvidence)
    private readonly detectedCrimeEvidenceRepo?: Repository<DetectedCrimeEvidence>,
  ) {}

  // ===========================================================================
  // RBAC YORDAMCHILARI
  // ===========================================================================

  private assertCanMutate(currentUser?: JwtAccessPayload): void {
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException(
        "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
      );
    }
  }

  private async getUserPermissionsContext(currentUser?: JwtAccessPayload): Promise<{
    canMutate: boolean;
    isDistrictOfficer: boolean;
    assignedDistrictIds: string[];
  }> {
    if (!currentUser) {
      return { canMutate: true, isDistrictOfficer: false, assignedDistrictIds: [] };
    }
    if (currentUser.role === Role.BOSS) {
      return { canMutate: false, isDistrictOfficer: false, assignedDistrictIds: [] };
    }
    if (currentUser.role === Role.DISTRICT_OFFICER) {
      const u = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      return {
        canMutate: true,
        isDistrictOfficer: true,
        assignedDistrictIds: u?.assigned_districts?.map((d) => d.id) || [],
      };
    }
    return { canMutate: true, isDistrictOfficer: false, assignedDistrictIds: [] };
  }

  private canEditApp(
    appDistrictId: string | null | undefined,
    ctx: { canMutate: boolean; isDistrictOfficer: boolean; assignedDistrictIds: string[] },
  ): boolean {
    if (!ctx.canMutate) return false;
    if (!ctx.isDistrictOfficer) return true;
    if (!appDistrictId) return false;
    return ctx.assignedDistrictIds.includes(appDistrictId);
  }

  private assertCanReassignOwnership(
    existingCitizenId: string | null | undefined,
    targetCitizenId: string,
    entityLabel: string,
    currentUser?: JwtAccessPayload,
  ): void {
    if (!existingCitizenId || existingCitizenId === targetCitizenId) return;
    const isPrivilegedAdmin =
      currentUser?.role === Role.SUPER_ADMIN || currentUser?.role === Role.ADMIN;
    if (!isPrivilegedAdmin) {
      throw new ConflictException(
        `Ushbu ${entityLabel} allaqachon boshqa fuqaroga biriktirilgan. Uni qayta biriktirish uchun Admin ruxsati talab etiladi`,
      );
    }
  }

  private normalizePersonName(name?: string | null): string {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/['ʻʼ`‘’]/g, "'")
      .replace(/[^a-z0-9а-яёўқғҳ'\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private formatCardDisplay(num?: string | null, masked?: string | null): string {
    const clean = (num || '').replace(/\D/g, '');
    if (clean.length === 16) {
      return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 12)} ${clean.slice(12, 16)}`;
    }
    return masked || num || 'Raqamsiz karta';
  }

  private formatCitizenFullName(cit?: Citizen | null): string {
    if (!cit) return 'Nomaʼlum shaxs';
    return cit.full_name?.trim() || 'Ism kiritilmagan';
  }

  // ===========================================================================
  // 1. GLOBAL QIDIRUV (CTRL + K COMMAND PALETTE)
  // ===========================================================================

  async globalSearch(
    rawQuery: string,
    category?: string,
    limit = 30,
    currentUser?: JwtAccessPayload,
  ): Promise<GlobalSearchResponse> {
    const q = (rawQuery || '').trim();
    if (!q) {
      return {
        query: '',
        totalCount: 0,
        items: [],
        countsByCategory: {
          citizens: 0,
          cards: 0,
          phones: 0,
          identifiers: 0,
          applications: 0,
          transfers: 0,
        },
      };
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);
    if (permCtx.isDistrictOfficer && permCtx.assignedDistrictIds.length === 0) {
      return {
        query: q,
        totalCount: 0,
        items: [],
        countsByCategory: {
          citizens: 0,
          cards: 0,
          phones: 0,
          identifiers: 0,
          applications: 0,
          transfers: 0,
        },
      };
    }

    const digits = q.replace(/\D/g, '');
    const handleClean = q
      .replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|instagram\.com)\//i, '')
      .replace(/^@+/, '')
      .trim();
    const ilikeQ = `%${escapeLikePattern(q)}%`;
    const digitsQ = `%${escapeLikePattern(digits)}%`;
    const handleQ = `%${escapeLikePattern(handleClean.toLowerCase())}%`;
    const perCategoryLimit = Math.min(Math.max(Number(limit) || 25, 10), 50);

    // 1. Fuqarolar qidiruvi
    const citizenQb = this.citizenRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.district', 'district')
      .leftJoinAndSelect('c.cards', 'cards')
      .where(
        `(
          c.full_name ILIKE :ilikeQ
          OR c.passport ILIKE :ilikeQ
          OR c.pinfl ILIKE :ilikeQ
          OR c.address ILIKE :ilikeQ
          ${digits.length >= 3 ? 'OR c.phone_number ILIKE :digitsQ OR c.pinfl ILIKE :digitsQ' : ''}
        )`,
        { ilikeQ, digitsQ },
      )
      .orderBy('c.created_at', 'DESC')
      .take(perCategoryLimit);

    // 2. Kartalar qidiruvi (to'liq raqam, oxirgi 4 raqam, niqoblangan raqam yoki F.I.O)
    const cardQb = this.cardRepo
      .createQueryBuilder('card')
      .leftJoinAndSelect('card.citizen', 'citizen')
      .leftJoinAndSelect('card.bank', 'bank')
      .where(
        `(
          card.card_number ILIKE :ilikeQ
          OR card.masked_number ILIKE :ilikeQ
          OR card.full_name ILIKE :ilikeQ
          ${digits.length >= 3 ? 'OR card.card_number ILIKE :digitsQ OR card.masked_number ILIKE :digitsQ' : ''}
        )`,
        { ilikeQ, digitsQ },
      )
      .orderBy('card.created_at', 'DESC')
      .take(perCategoryLimit);

    // 3. Telefonlar qidiruvi
    const phoneQb = this.phoneRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.citizen', 'citizen')
      .where(
        `(
          p.phone_number ILIKE :ilikeQ
          OR p.formatted_number ILIKE :ilikeQ
          OR p.label ILIKE :ilikeQ
          OR p.operator ILIKE :ilikeQ
          ${digits.length >= 3 ? 'OR p.phone_number ILIKE :digitsQ' : ''}
        )`,
        { ilikeQ, digitsQ },
      )
      .orderBy('p.created_at', 'DESC')
      .take(perCategoryLimit);

    // 4. Raqamli izlar (Telegram, IP, Kripto, IMEI va h.k.)
    const identQb = this.identifierRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.citizen', 'citizen')
      .where(
        `(
          d.raw_value ILIKE :ilikeQ
          OR d.normalized_value ILIKE :handleQ
          OR d.type_label ILIKE :ilikeQ
          OR d.notes ILIKE :ilikeQ
        )`,
        { ilikeQ, handleQ },
      )
      .orderBy('d.created_at', 'DESC')
      .take(perCategoryLimit);

    // 5. Arizalar qidiruvi
    const appQb = this.appRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.citizen', 'citizen')
      .leftJoinAndSelect('a.district', 'district')
      .leftJoinAndSelect('a.transfer', 'transfer')
      .leftJoinAndSelect('a.application_status', 'appStatus')
      .where('a.is_deleted = false')
      .andWhere(
        `(
          a.application_number ILIKE :ilikeQ
          OR a.description ILIKE :ilikeQ
          OR a.officer_notes ILIKE :ilikeQ
        )`,
        { ilikeQ },
      )
      .orderBy('a.created_at', 'DESC')
      .take(perCategoryLimit);

    // 6. O'tkazmalar qidiruvi
    const transferQb = this.transferRepo
      .createQueryBuilder('tr')
      .leftJoinAndSelect('tr.sender_card', 'senderCard')
      .leftJoinAndSelect('tr.receiver_card', 'receiverCard')
      .leftJoinAndSelect('tr.payment_provider', 'provider')
      .where(
        `(
          tr.transaction_id ILIKE :ilikeQ
          ${digits.length >= 4 ? 'OR CAST(tr.amount AS TEXT) ILIKE :digitsQ' : ''}
        )`,
        { ilikeQ, digitsQ },
      )
      .orderBy('tr.created_at', 'DESC')
      .take(15);

    if (permCtx.isDistrictOfficer) {
      const assignedIds = permCtx.assignedDistrictIds;
      citizenQb.andWhere(
        `(c.district_id IN (:...assignedIds) OR EXISTS (SELECT 1 FROM applications a_sc WHERE a_sc.citizen_id = c.id AND a_sc.is_deleted = false AND a_sc.district_id IN (:...assignedIds)))`,
        { assignedIds },
      );
      cardQb.andWhere(
        `(citizen.district_id IN (:...assignedIds) OR EXISTS (SELECT 1 FROM entity_application_links e_sc INNER JOIN applications a_sc ON a_sc.id = e_sc.application_id WHERE e_sc.card_id = card.id AND a_sc.is_deleted = false AND a_sc.district_id IN (:...assignedIds)))`,
        { assignedIds },
      );
      phoneQb.andWhere(
        `(citizen.district_id IN (:...assignedIds) OR EXISTS (SELECT 1 FROM entity_application_links e_sc INNER JOIN applications a_sc ON a_sc.id = e_sc.application_id WHERE e_sc.phone_id = p.id AND a_sc.is_deleted = false AND a_sc.district_id IN (:...assignedIds)))`,
        { assignedIds },
      );
      identQb.andWhere(
        `(citizen.district_id IN (:...assignedIds) OR EXISTS (SELECT 1 FROM entity_application_links e_sc INNER JOIN applications a_sc ON a_sc.id = e_sc.application_id WHERE e_sc.identifier_id = d.id AND a_sc.is_deleted = false AND a_sc.district_id IN (:...assignedIds)))`,
        { assignedIds },
      );
      appQb.andWhere('a.district_id IN (:...assignedIds)', { assignedIds });
      transferQb.andWhere(
        `EXISTS (SELECT 1 FROM applications a_sc WHERE (a_sc.id = tr.application_id OR a_sc.transfer_id = tr.id) AND a_sc.is_deleted = false AND a_sc.district_id IN (:...assignedIds))`,
        { assignedIds },
      );
    }

    const [citizens, cards, phones, identifiers, apps, transfers] = await Promise.all([
      citizenQb.getMany(),
      cardQb.getMany(),
      phoneQb.getMany(),
      identQb.getMany(),
      appQb.getMany(),
      transferQb.getMany(),
    ]);

    // Mini-statistika uchun bog'liqliklarni bitta batch so'rov bilan olish
    const citIds = citizens.map((c) => c.id);
    const cardIds = cards.map((c) => c.id);
    const phoneIds = phones.map((p) => p.id);
    const identIds = identifiers.map((i) => i.id);

    const relevantLinks =
      citIds.length || cardIds.length || phoneIds.length || identIds.length
        ? await this.linkRepo.find({
            where: [
              ...(citIds.length ? [{ citizen_id: In(citIds) }] : []),
              ...(cardIds.length ? [{ card_id: In(cardIds) }] : []),
              ...(phoneIds.length ? [{ phone_id: In(phoneIds) }] : []),
              ...(identIds.length ? [{ identifier_id: In(identIds) }] : []),
            ],
            relations: { application: { transfer: true } },
          })
        : [];

    const computeQuickStats = (
      predicate: (l: EntityApplicationLink) => boolean,
    ): {
      appsCount: number;
      suspectCount: number;
      victimCount: number;
      totalAmount: number;
    } => {
      const appSet = new Set<string>();
      const suspectSet = new Set<string>();
      const victimSet = new Set<string>();
      let totalAmount = 0;

      for (const l of relevantLinks) {
        if (!predicate(l) || !l.application || l.application.is_deleted) continue;
        if (!appSet.has(l.application_id)) {
          appSet.add(l.application_id);
          totalAmount += Number(l.application.transfer?.amount || 0);
        }
        if (l.role === 'SUSPECT' || l.role === 'DROPPER') {
          suspectSet.add(l.application_id);
        } else if (l.role === 'VICTIM') {
          victimSet.add(l.application_id);
        }
      }
      return {
        appsCount: appSet.size,
        suspectCount: suspectSet.size,
        victimCount: victimSet.size,
        totalAmount,
      };
    };

    const items: GlobalSearchResultItem[] = [];

    for (const c of citizens) {
      const st = computeQuickStats((l) => l.citizen_id === c.id);
      const isMixed = st.suspectCount > 0 && st.victimCount > 0;
      const isSuspect = st.suspectCount > 0;
      const risk = isSuspect
        ? Math.min(95, 65 + st.suspectCount * 10)
        : st.victimCount > 0
          ? 15
          : 0;

      items.push({
        id: c.id,
        category: 'citizens',
        title: this.formatCitizenFullName(c),
        subtitle:
          [
            c.passport ? `Pasport: ${c.passport}` : null,
            c.pinfl ? `JSHSHIR: ${c.pinfl}` : null,
            c.phone_number ? formatPhoneDisplay(c.phone_number) : null,
            c.district?.name || null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Shaxsiy profil',
        badgeLabel: isMixed
          ? 'Aralash rol (Shubhali)'
          : isSuspect
            ? `Dropper / Gumonlanuvchi (${st.suspectCount})`
            : st.victimCount > 0
              ? `Jabrlanuvchi (${st.victimCount})`
              : 'Fuqaro',
        badgeVariant: isMixed || isSuspect ? 'danger' : st.victimCount > 0 ? 'info' : 'neutral',
        appsCount: st.appsCount,
        totalAmount: st.totalAmount,
        riskScore: risk,
        targetRoute: `/citizens/${c.id}`,
      });
    }

    for (const card of cards) {
      const st = computeQuickStats((l) => l.card_id === card.id);
      const isDropper = st.suspectCount > 0;
      const owner = card.citizen
        ? this.formatCitizenFullName(card.citizen)
        : card.full_name || 'Egasi biriktirilmagan';
      const bank =
        card.bank?.name || this.financialFlowService.identifyBank(card.card_number || '');

      items.push({
        id: card.id,
        category: 'cards',
        title: this.formatCardDisplay(card.card_number, card.masked_number),
        subtitle: `${bank} · Egasi: ${owner}`,
        badgeLabel: isDropper
          ? `Firibgar / Dropper (${st.suspectCount} ta ariza)`
          : st.victimCount > 0
            ? 'Jabrlanuvchi kartasi'
            : 'Plastik karta',
        badgeVariant: isDropper ? 'danger' : st.victimCount > 0 ? 'info' : 'neutral',
        appsCount: st.appsCount,
        totalAmount: st.totalAmount,
        riskScore: isDropper ? Math.min(95, 70 + st.suspectCount * 10) : 15,
        targetRoute: `/cards/${card.id}`,
      });
    }

    for (const p of phones) {
      const st = computeQuickStats((l) => l.phone_id === p.id);
      const isSuspect = st.suspectCount > 0;
      const owner = p.citizen ? this.formatCitizenFullName(p.citizen) : 'Egasi nomaʼlum';

      items.push({
        id: p.id,
        category: 'phones',
        title: p.formatted_number || formatPhoneDisplay(p.phone_number) || p.phone_number,
        subtitle: `${p.operator || 'Aloqa'} · Egasi: ${owner}`,
        badgeLabel: isSuspect
          ? `Gumonlanuvchi raqami (${st.suspectCount})`
          : st.victimCount > 0
            ? 'Fuqaro raqami'
            : 'Telefon',
        badgeVariant: isSuspect ? 'danger' : st.victimCount > 0 ? 'info' : 'neutral',
        appsCount: st.appsCount,
        totalAmount: st.totalAmount,
        riskScore: isSuspect ? Math.min(92, 65 + st.suspectCount * 10) : 10,
        targetRoute: `/dossier/phone/${p.id}`,
      });
    }

    for (const d of identifiers) {
      const st = computeQuickStats((l) => l.identifier_id === d.id);
      const owner = d.citizen ? this.formatCitizenFullName(d.citizen) : 'Egasi aniqlanmagan';

      items.push({
        id: d.id,
        category: 'identifiers',
        title: d.raw_value,
        subtitle: `${d.type_label || getIdentifierTypeLabel(d.type)} · Egasi: ${owner}`,
        badgeLabel:
          st.suspectCount > 0
            ? `Gumonlanuvchi izi (${st.suspectCount} ta ariza)`
            : d.type_label || 'Raqamli iz',
        badgeVariant: st.suspectCount > 0 ? 'danger' : 'warning',
        appsCount: st.appsCount,
        totalAmount: st.totalAmount,
        riskScore: st.suspectCount > 0 ? Math.min(95, 70 + st.suspectCount * 10) : 40,
        targetRoute: `/dossier/identifier/${d.id}`,
      });
    }

    for (const a of apps) {
      const citName = a.citizen ? this.formatCitizenFullName(a.citizen) : 'Arizachi kiritilmagan';
      const amt = Number(a.transfer?.amount || 0);
      items.push({
        id: a.id,
        category: 'applications',
        title: `Ariza № ${a.application_number || 'Raqamsiz'}`,
        subtitle: `${citName}${a.district?.name ? ` · ${a.district.name}` : ''}${a.description ? ` — ${a.description.slice(0, 70)}` : ''}`,
        badgeLabel: a.application_status?.name || a.status || 'YANGI',
        badgeVariant: 'info',
        appsCount: 1,
        totalAmount: amt,
        riskScore: 0,
        targetRoute: `/applications/${a.id}`,
      });
    }

    for (const tr of transfers) {
      const amt = Number(tr.amount || 0);
      const sMask = tr.sender_card
        ? this.formatCardDisplay(tr.sender_card.card_number, tr.sender_card.masked_number)
        : 'Nomaʼlum';
      const rMask = tr.receiver_card
        ? this.formatCardDisplay(tr.receiver_card.card_number, tr.receiver_card.masked_number)
        : 'Nomaʼlum';
      const route = tr.application_id
        ? `/applications/${tr.application_id}`
        : tr.receiver_card_id
          ? `/cards/${tr.receiver_card_id}`
          : `/transfers`;

      items.push({
        id: tr.id,
        category: 'transfers',
        title: tr.transaction_id ? `Chek #${tr.transaction_id}` : `Oʻtkazma: ${sMask} ➔ ${rMask}`,
        subtitle: `${tr.payment_provider?.name || 'Toʻlov'} · ${sMask} ➔ ${rMask}`,
        badgeLabel: 'Pul oʻtkazmasi',
        badgeVariant: 'success',
        appsCount: tr.application_id ? 1 : 0,
        totalAmount: amt,
        riskScore: 0,
        targetRoute: route,
      });
    }

    const countsByCategory: Record<string, number> = {
      citizens: citizens.length,
      cards: cards.length,
      phones: phones.length,
      identifiers: identifiers.length,
      applications: apps.length,
      transfers: transfers.length,
    };

    const filteredItems =
      category && category !== 'all' ? items.filter((it) => it.category === category) : items;

    // Eng muhim va ko'p bog'langan natijalarni yuqoriga saralash
    filteredItems.sort((a, b) => {
      if (b.appsCount !== a.appsCount) return b.appsCount - a.appsCount;
      return b.riskScore - a.riskScore;
    });

    return {
      query: q,
      totalCount: items.length,
      items: filteredItems,
      countsByCategory,
    };
  }

  // ===========================================================================
  // 2. JONLI RADAR (LIVE COLLISION CHECK WHILE TYPING IN FORMS)
  // ===========================================================================

  async checkRadar(
    type: string,
    rawValue: string,
    excludeAppId?: string,
    currentUser?: JwtAccessPayload,
  ): Promise<LiveRadarResponse> {
    const empty: LiveRadarResponse = {
      found: false,
      appsCount: 0,
      suspectCount: 0,
      victimCount: 0,
      totalLoss: 0,
      riskLevel: 'NONE',
      recentApplications: [],
    };

    if (!rawValue || rawValue.trim().length < 3) return empty;

    const cleanType = (type || 'other_info').toLowerCase();
    if (
      !isPhoneLikeFieldKey(cleanType) &&
      !isCardLikeFieldKey(cleanType) &&
      cleanType !== 'pinfl' &&
      cleanType !== 'passport' &&
      !isLinkableIdentifierType(cleanType)
    ) {
      return empty;
    }

    let entityType: 'card' | 'phone' | 'identifier' | 'citizen' | undefined;
    let entityId: string | undefined;
    let title: string | undefined;
    let subtitle: string | undefined;
    let targetRoute: string | undefined;
    let ownerCitizen: LiveRadarResponse['ownerCitizen'] = null;
    let links: EntityApplicationLink[] = [];
    const dcTokens: string[] = [];
    const dcCitizenIds: string[] = [];

    if (isCardLikeFieldKey(cleanType)) {
      const digits = rawValue.replace(/\D/g, '');
      if (digits.length < 8) return empty;
      dcTokens.push(digits);
      const card = await this.cardRepo.findOne({
        where: { card_number: digits },
        relations: { citizen: true, bank: true },
      });
      if (card) {
        entityType = 'card';
        entityId = card.id;
        title = this.formatCardDisplay(card.card_number, card.masked_number);
        subtitle = card.bank?.name || this.financialFlowService.identifyBank(digits);
        targetRoute = `/cards/${card.id}`;
        if (card.citizen) {
          dcCitizenIds.push(card.citizen.id);
          ownerCitizen = {
            id: card.citizen.id,
            fullName: this.formatCitizenFullName(card.citizen),
            phone: card.citizen.phone_number,
          };
        }
        links = await this.linkRepo.find({
          where: { card_id: card.id },
          relations: { application: { transfer: true } },
        });
      }
    } else if (isPhoneLikeFieldKey(cleanType)) {
      const digits = normalizePhoneDigits(rawValue);
      if (digits.length < 7) return empty;
      dcTokens.push(digits);
      const phone = await this.phoneRepo.findOne({
        where: { phone_number: digits },
        relations: { citizen: true },
      });
      if (phone) {
        entityType = 'phone';
        entityId = phone.id;
        title = phone.formatted_number || formatPhoneDisplay(phone.phone_number);
        subtitle = phone.operator || 'Aloqa tarmogʻi';
        targetRoute = `/dossier/phone/${phone.id}`;
        if (phone.citizen) {
          dcCitizenIds.push(phone.citizen.id);
          ownerCitizen = {
            id: phone.citizen.id,
            fullName: this.formatCitizenFullName(phone.citizen),
            phone: phone.citizen.phone_number,
          };
        }
        links = await this.linkRepo.find({
          where: { phone_id: phone.id },
          relations: { application: { transfer: true } },
        });
      }
    } else if (cleanType === 'pinfl' || cleanType === 'passport') {
      const cleanVal =
        cleanType === 'pinfl' ? rawValue.replace(/\D/g, '') : normalizePassport(rawValue) || '';
      if (cleanVal.length < 6) return empty;

      const citizen = await this.citizenRepo.findOne({
        where: cleanType === 'pinfl' ? { pinfl: cleanVal } : { passport: cleanVal },
      });
      if (citizen) {
        dcCitizenIds.push(citizen.id);
        entityType = 'citizen';
        entityId = citizen.id;
        title = this.formatCitizenFullName(citizen);
        subtitle = `${cleanType.toUpperCase()}: ${cleanVal}`;
        targetRoute = `/citizens/${citizen.id}`;
        ownerCitizen = {
          id: citizen.id,
          fullName: title,
          phone: citizen.phone_number,
        };
        links = await this.linkRepo.find({
          where: { citizen_id: citizen.id },
          relations: { application: { transfer: true } },
        });
      }
    } else {
      const normalized = normalizeIdentifierValue(cleanType, rawValue);
      if (normalized.length < 3) return empty;
      dcTokens.push(normalized);

      const exactIdent = await this.identifierRepo.findOne({
        where: { type: cleanType, normalized_value: normalized },
        relations: { citizen: true },
      });
      const ident =
        exactIdent ||
        (await this.identifierRepo.findOne({
          where: { normalized_value: normalized },
          relations: { citizen: true },
        }));
      if (ident) {
        entityType = 'identifier';
        entityId = ident.id;
        title = ident.raw_value;
        subtitle = ident.type_label || getIdentifierTypeLabel(ident.type);
        targetRoute = `/dossier/identifier/${ident.id}`;
        if (ident.citizen) {
          dcCitizenIds.push(ident.citizen.id);
          ownerCitizen = {
            id: ident.citizen.id,
            fullName: this.formatCitizenFullName(ident.citizen),
            phone: ident.citizen.phone_number,
          };
        }
        links = await this.linkRepo.find({
          where: { identifier_id: ident.id },
          relations: { application: { transfer: true } },
        });
      }
    }

    const detectedCrimesFound = await this.findDetectedCrimesForEntities(
      {
        citizenIds: dcCitizenIds,
        cardNumbers: isCardLikeFieldKey(cleanType) ? dcTokens : [],
        phoneDigits: isPhoneLikeFieldKey(cleanType) ? dcTokens : [],
        identifierValues:
          !isCardLikeFieldKey(cleanType) &&
          !isPhoneLikeFieldKey(cleanType) &&
          cleanType !== 'pinfl' &&
          cleanType !== 'passport'
            ? dcTokens
            : [],
      },
      currentUser,
    );

    if (!entityId && detectedCrimesFound.length === 0) return empty;

    const filteredLinks = links.filter(
      (l) => l.application && !l.application.is_deleted && l.application_id !== excludeAppId,
    );

    if (filteredLinks.length === 0 && !ownerCitizen && detectedCrimesFound.length === 0) {
      return {
        found: true,
        entityType,
        entityId,
        title,
        subtitle,
        targetRoute,
        ownerCitizen: null,
        appsCount: 0,
        suspectCount: 0,
        victimCount: 0,
        detectedCrimesCount: 0,
        detectedCrimes: [],
        totalLoss: 0,
        riskLevel: 'LOW',
        recentApplications: [],
      };
    }

    const rolePriority: Record<EntityLinkRole, number> = {
      SUSPECT: 5,
      DROPPER: 4,
      TRANSIT: 3,
      VICTIM: 2,
      WITNESS: 1,
      RELATED: 0,
    };

    const byApp = new Map<
      string,
      {
        id: string;
        application_number: string;
        role: EntityLinkRole;
        date: string | null;
        amount: number | null;
        currency: string;
      }
    >();

    for (const l of filteredLinks) {
      const app = l.application;
      const amt = app.transfer?.amount ? Number(app.transfer.amount) : null;
      const curr = (app.transfer?.currency || 'UZS').toUpperCase();
      const existing = byApp.get(app.id);
      if (!existing) {
        byApp.set(app.id, {
          id: app.id,
          application_number: app.application_number || 'Raqamsiz',
          role: l.role,
          date: app.date ? new Date(app.date).toISOString() : app.created_at.toISOString(),
          amount: amt,
          currency: curr,
        });
      } else if (rolePriority[l.role] > rolePriority[existing.role]) {
        existing.role = l.role;
      }
    }

    let suspectCount = 0;
    let victimCount = 0;
    let totalLoss = 0;
    const hasUzsLoss = Array.from(byApp.values()).some(
      (a) => a.currency === 'UZS' && (a.amount || 0) > 0,
    );
    for (const item of byApp.values()) {
      if (!hasUzsLoss || item.currency === 'UZS') {
        totalLoss += item.amount || 0;
      }
      if (item.role === 'SUSPECT' || item.role === 'DROPPER' || item.role === 'TRANSIT')
        suspectCount++;
      else if (item.role === 'VICTIM') victimCount++;
    }

    const riskLevel: LiveRadarResponse['riskLevel'] =
      suspectCount >= 2 || detectedCrimesFound.length > 0
        ? 'CRITICAL'
        : suspectCount === 1
          ? 'HIGH'
          : victimCount > 0
            ? 'MEDIUM'
            : 'LOW';

    const permCtx = await this.getUserPermissionsContext(currentUser);
    const recentApplications = Array.from(byApp.values())
      .slice(0, 5)
      .map((item) => {
        if (permCtx.isDistrictOfficer) {
          const linkedApp = links.find((l) => l.application?.id === item.id)?.application;
          const allowed = Boolean(
            linkedApp?.district_id && permCtx.assignedDistrictIds.includes(linkedApp.district_id),
          );
          if (!allowed) {
            return {
              ...item,
              application_number: 'Boshqa tuman (yopiq)',
            };
          }
        }
        return item;
      });

    return {
      found: true,
      entityType,
      entityId,
      title: title || rawValue.trim(),
      subtitle: subtitle || getIdentifierTypeLabel(cleanType),
      targetRoute: targetRoute || detectedCrimesFound[0]?.target_route,
      ownerCitizen,
      appsCount: byApp.size,
      suspectCount,
      victimCount,
      detectedCrimesCount: detectedCrimesFound.length,
      detectedCrimes: detectedCrimesFound.slice(0, 5).map((dc) => ({
        id: dc.id,
        case_number: dc.case_number,
        title: dc.title,
        matched_by: dc.matched_by.join(', '),
      })),
      totalLoss,
      riskLevel,
      recentApplications,
    };
  }

  // ===========================================================================
  // 3. UMUMIY MIKRO-STATISTIKA VA GRAF HISOBLAGICHLARI
  // ===========================================================================

  private buildMicroStats(
    directApps: DossierApplicationItem[],
    transfers: DossierTransferItem[],
  ): DossierMicroStats {
    let victimAppsCount = 0;
    let suspectOrDropperAppsCount = 0;
    let witnessAppsCount = 0;
    let totalLossInLinkedApps = 0;

    const districtMap = new Map<string, { name: string; count: number; loss: number }>();
    const crimeMap = new Map<string, { article: string; title: string | null; count: number }>();
    const providerMap = new Map<string, { name: string; count: number; amount: number }>();
    const allDates: number[] = [];

    const hasUzsAppLoss = directApps.some(
      (a) => (a.currency || 'UZS').toUpperCase() === 'UZS' && Number(a.transfer_amount || 0) > 0,
    );

    for (const a of directApps) {
      if (a.role_in_app === 'VICTIM') victimAppsCount++;
      else if (
        a.role_in_app === 'SUSPECT' ||
        a.role_in_app === 'DROPPER' ||
        a.role_in_app === 'TRANSIT'
      )
        suspectOrDropperAppsCount++;
      else if (a.role_in_app === 'WITNESS') witnessAppsCount++;

      const amt = Number(a.transfer_amount || 0);
      const curr = (a.currency || 'UZS').toUpperCase();
      if (!hasUzsAppLoss || curr === 'UZS') {
        totalLossInLinkedApps += amt;
      }

      if (a.date) {
        const ts = new Date(a.date).getTime();
        if (!isNaN(ts)) allDates.push(ts);
      }

      if (a.district_name) {
        const d = districtMap.get(a.district_name) || {
          name: a.district_name,
          count: 0,
          loss: 0,
        };
        d.count++;
        if (!hasUzsAppLoss || curr === 'UZS') {
          d.loss += amt;
        }
        districtMap.set(a.district_name, d);
      }

      if (a.crime_article) {
        const c = crimeMap.get(a.crime_article) || {
          article: a.crime_article,
          title: a.crime_method || null,
          count: 0,
        };
        c.count++;
        crimeMap.set(a.crime_article, c);
      }

      if (transfers.length === 0 && a.payment_provider) {
        const p = providerMap.get(a.payment_provider) || {
          name: a.payment_provider,
          count: 0,
          amount: 0,
        };
        p.count++;
        if (!hasUzsAppLoss || curr === 'UZS') {
          p.amount += amt;
        }
        providerMap.set(a.payment_provider, p);
      }
    }

    let totalIncomingAmount = 0;
    let totalOutgoingAmount = 0;
    let totalInternalAmount = 0;
    let maxTransactionAmount = 0;
    const hasUzsTransfer = transfers.some(
      (t) => (t.currency || 'UZS').toUpperCase() === 'UZS' && Number(t.amount || 0) > 0,
    );

    const hourlySlots = [
      { slot: '00:00–04:00', count: 0, amount: 0 },
      { slot: '04:00–08:00', count: 0, amount: 0 },
      { slot: '08:00–12:00', count: 0, amount: 0 },
      { slot: '12:00–16:00', count: 0, amount: 0 },
      { slot: '16:00–20:00', count: 0, amount: 0 },
      { slot: '20:00–24:00', count: 0, amount: 0 },
    ];

    for (const tr of transfers) {
      const amt = Number(tr.amount || 0);
      const curr = (tr.currency || 'UZS').toUpperCase();
      const countableAmt = !hasUzsTransfer || curr === 'UZS' ? amt : 0;

      if (tr.direction === 'INCOMING') totalIncomingAmount += countableAmt;
      else if (tr.direction === 'OUTGOING') totalOutgoingAmount += countableAmt;
      else totalInternalAmount += countableAmt;

      if (countableAmt > maxTransactionAmount) maxTransactionAmount = countableAmt;

      if (tr.transfer_date) {
        const ts = new Date(tr.transfer_date).getTime();
        if (!isNaN(ts)) allDates.push(ts);
      }

      if (tr.payment_provider) {
        const p = providerMap.get(tr.payment_provider) || {
          name: tr.payment_provider,
          count: 0,
          amount: 0,
        };
        p.count++;
        p.amount += countableAmt;
        providerMap.set(tr.payment_provider, p);
      }

      let hour: number | null = null;
      if (tr.transfer_time) {
        const m = tr.transfer_time.match(/^(\d{1,2}):/);
        if (m) hour = parseInt(m[1], 10);
      }
      if (hour !== null && hour >= 0 && hour < 24) {
        const idx = Math.min(Math.floor(hour / 4), 5);
        hourlySlots[idx].count++;
        hourlySlots[idx].amount += countableAmt;
      }
    }

    const totalVolume = totalIncomingAmount + totalOutgoingAmount + totalInternalAmount;
    const avgTransactionAmount =
      transfers.length > 0 ? Math.round(totalVolume / transfers.length) : 0;

    allDates.sort((a, b) => a - b);
    const firstSeenDate = allDates.length > 0 ? new Date(allDates[0]).toISOString() : null;
    const lastSeenDate =
      allDates.length > 0 ? new Date(allDates[allDates.length - 1]).toISOString() : null;
    const activeSpanDays =
      allDates.length >= 2
        ? Math.max(1, Math.ceil((allDates[allDates.length - 1] - allDates[0]) / (1000 * 3600 * 24)))
        : allDates.length === 1
          ? 1
          : 0;

    const isCrossRoleCollision = victimAppsCount > 0 && suspectOrDropperAppsCount > 0;

    let riskScore = 10;
    if (suspectOrDropperAppsCount > 0) {
      riskScore = Math.min(
        98,
        65 + suspectOrDropperAppsCount * 10 + (isCrossRoleCollision ? 10 : 0),
      );
    } else if (totalIncomingAmount > 0 && totalOutgoingAmount > 0) {
      riskScore = 45;
    } else if (victimAppsCount > 0) {
      riskScore = 15;
    }

    const riskLevel: DossierMicroStats['riskLevel'] =
      riskScore >= 80 ? 'CRITICAL' : riskScore >= 60 ? 'HIGH' : riskScore >= 35 ? 'MEDIUM' : 'LOW';

    const riskLabel = isCrossRoleCollision
      ? 'Ikki tomonlama shubhali profil (Jabrlanuvchi + Dropper/Gumonlanuvchi)'
      : riskLevel === 'CRITICAL'
        ? 'Oʻta xavfli seriyali firibgar / Dropper'
        : riskLevel === 'HIGH'
          ? 'Yuqori xavfli (Gumonlanuvchi / Dropper)'
          : riskLevel === 'MEDIUM'
            ? 'Tranzit / Tekshiruv talab etiladi'
            : 'Jabrlanuvchi / Oddiy fuqaro';

    return {
      totalApplications: directApps.length,
      victimAppsCount,
      suspectOrDropperAppsCount,
      witnessAppsCount,
      isCrossRoleCollision,
      totalLossInLinkedApps,
      totalIncomingAmount,
      totalOutgoingAmount,
      netFlowAmount: totalIncomingAmount - totalOutgoingAmount,
      transactionsCount: transfers.length,
      avgTransactionAmount,
      maxTransactionAmount,
      firstSeenDate,
      lastSeenDate,
      activeSpanDays,
      riskScore,
      riskLevel,
      riskLabel,
      hourlyDistribution: hourlySlots,
      byDistrict: Array.from(districtMap.values()).sort((a, b) => b.count - a.count),
      byPaymentProvider: Array.from(providerMap.values()).sort((a, b) => b.amount - a.amount),
      byCrime: Array.from(crimeMap.values()).sort((a, b) => b.count - a.count),
    };
  }

  private async loadDetailedApplications(appIds: string[]): Promise<Application[]> {
    if (appIds.length === 0) return [];
    return this.appRepo.find({
      where: { id: In(appIds), is_deleted: false },
      relations: {
        application_status: true,
        citizen: true,
        district: true,
        crime: true,
        crime_method: true,
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: { bank: true, citizen: true },
          receiver_card: { bank: true, citizen: true },
          custom_fields: true,
        },
        custom_fields: {
          card: { bank: true, citizen: true },
          citizen: true,
          transfer: {
            payment_provider: true,
            sender_card: { bank: true, citizen: true },
            receiver_card: { bank: true, citizen: true },
          },
        },
      },
      order: { date: 'DESC', created_at: 'DESC' },
    });
  }

  private extractEvidenceFiles(apps: Application[]): FullDossierResponse['evidenceFiles'] {
    const files: FullDossierResponse['evidenceFiles'] = [];
    const seen = new Set<string>();

    const addUrl = (url: unknown, title: string, app: Application) => {
      if (typeof url !== 'string' || !url.trim()) return;
      const u = url.trim();
      if (seen.has(u)) return;
      seen.add(u);
      const isImg = /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(u);
      files.push({
        url: u,
        title,
        application_id: app.id,
        application_number: app.application_number || 'Raqamsiz',
        is_image: isImg,
      });
    };

    for (const app of apps) {
      for (const cf of app.custom_fields || []) {
        const cfType = String(cf.type || '');
        if (cfType === 'IMAGES' || cfType === 'FILES') {
          if (Array.isArray(cf.value)) {
            cf.value.forEach((v) => addUrl(v, cf.label || 'Dalil fayl', app));
          } else {
            addUrl(cf.value, cf.label || 'Dalil fayl', app);
          }
        }
      }
      for (const tf of app.transfer?.custom_fields || []) {
        const tfType = String(tf.type || '');
        if (tfType === 'IMAGES' || tfType === 'FILES') {
          if (Array.isArray(tf.value)) {
            tf.value.forEach((v) => addUrl(v, tf.label || 'Chek / Kvitansiya', app));
          } else {
            addUrl(tf.value, tf.label || 'Chek / Kvitansiya', app);
          }
        }
      }
    }
    return files;
  }

  private buildFinancialSubgraph(
    cards: Card[],
    transfers: Transfer[],
    focusCardIds: Set<string>,
  ): {
    nodes: IGraphNode[];
    edges: IGraphEdge[];
    summary: {
      totalCards: number;
      totalFlowAmount: number;
      droppersCount: number;
      transitCount: number;
      blacklistedCount: number;
    };
  } {
    const nodeMap = new Map<string, IGraphNode>();
    const edgeMap = new Map<string, IGraphEdge>();

    const ensureNode = (c: Card | null | undefined, defaultRole: IGraphNode['role']) => {
      if (!c) return null;
      if (!nodeMap.has(c.id)) {
        const clean = (c.card_number || '').replace(/\D/g, '');
        const owner = c.citizen ? this.formatCitizenFullName(c.citizen) : c.full_name || undefined;
        nodeMap.set(c.id, {
          id: c.id,
          cardNumber: clean || c.masked_number || 'Karta',
          maskedCard: this.formatCardDisplay(c.card_number, c.masked_number),
          bankName: c.bank?.name || this.financialFlowService.identifyBank(clean),
          totalIn: 0,
          totalOut: 0,
          netFlow: 0,
          inDegree: 0,
          outDegree: 0,
          reportsCount: 0,
          reportIds: [],
          riskScore: defaultRole === 'MULE_DROPPER' ? 80 : 20,
          role: defaultRole,
          isBlacklisted: focusCardIds.has(c.id) && defaultRole === 'MULE_DROPPER',
          ownerName: owner,
          phone: c.citizen?.phone_number || undefined,
          passport: c.citizen?.passport || undefined,
          pinfl: c.citizen?.pinfl || undefined,
          linkedApplications: [],
        });
      }
      return nodeMap.get(c.id)!;
    };

    for (const c of cards) {
      ensureNode(c, 'TRANSIT');
    }

    for (const tr of transfers) {
      const amt = Number(tr.amount || 0);
      const sNode = ensureNode(tr.sender_card, 'VICTIM_SOURCE');
      const rNode = ensureNode(tr.receiver_card, 'MULE_DROPPER');
      if (sNode && rNode && sNode.id !== rNode.id) {
        sNode.totalOut += amt;
        sNode.outDegree += 1;
        rNode.totalIn += amt;
        rNode.inDegree += 1;

        const key = `${sNode.id}__${rNode.id}`;
        if (edgeMap.has(key)) {
          const ex = edgeMap.get(key)!;
          ex.amount += amt;
          ex.transactionsCount += 1;
        } else {
          edgeMap.set(key, {
            id: tr.id,
            from: sNode.id,
            to: rNode.id,
            amount: amt,
            paymentProvider: tr.payment_provider?.name || 'Toʻlov',
            transactionsCount: 1,
            lastDate: tr.transfer_date || tr.created_at?.toISOString() || '',
            applicationId: tr.application_id || undefined,
          });
        }
      }
    }

    let droppersCount = 0;
    let transitCount = 0;
    let blacklistedCount = 0;

    for (const n of nodeMap.values()) {
      n.netFlow = n.totalIn - n.totalOut;
      if (n.inDegree > 0 && n.outDegree === 0) {
        n.role = 'MULE_DROPPER';
        n.riskScore = Math.min(95, 70 + n.inDegree * 8);
        droppersCount++;
      } else if (n.inDegree > 0 && n.outDegree > 0) {
        n.role = 'TRANSIT';
        n.riskScore = 55;
        transitCount++;
      } else {
        n.role = 'VICTIM_SOURCE';
        n.riskScore = 15;
      }
      if (n.riskScore >= 75) blacklistedCount++;
    }

    const edges = Array.from(edgeMap.values());
    return {
      nodes: Array.from(nodeMap.values()),
      edges,
      summary: {
        totalCards: nodeMap.size,
        totalFlowAmount: edges.reduce((sum, e) => sum + e.amount, 0),
        droppersCount,
        transitCount,
        blacklistedCount,
      },
    };
  }

  private async computeCoOccurringClues(
    appIds: string[],
    excludeKeys: Set<string>,
  ): Promise<CoOccurringClueItem[]> {
    if (appIds.length === 0) return [];

    const allLinksInApps = await this.linkRepo.find({
      where: { application_id: In(appIds) },
      relations: {
        card: { citizen: true, bank: true },
        phone: { citizen: true },
        identifier: { citizen: true },
        citizen: true,
      },
    });

    const clueMap = new Map<
      string,
      {
        item: CoOccurringClueItem;
        apps: Set<string>;
      }
    >();

    for (const l of allLinksInApps) {
      if (l.card) {
        const key = `card:${l.card.id}`;
        if (!excludeKeys.has(key)) {
          if (!clueMap.has(key)) {
            clueMap.set(key, {
              apps: new Set(),
              item: {
                id: l.card.id,
                entity_type: 'card',
                type_label: l.card.bank?.name || 'Plastik karta',
                value: this.formatCardDisplay(l.card.card_number, l.card.masked_number),
                owner_name: l.card.citizen
                  ? this.formatCitizenFullName(l.card.citizen)
                  : l.card.full_name || null,
                shared_apps_count: 0,
                role: l.role,
                target_route: `/cards/${l.card.id}`,
              },
            });
          }
          clueMap.get(key)!.apps.add(l.application_id);
        }
      }

      if (l.phone) {
        const key = `phone:${l.phone.id}`;
        if (!excludeKeys.has(key)) {
          if (!clueMap.has(key)) {
            clueMap.set(key, {
              apps: new Set(),
              item: {
                id: l.phone.id,
                entity_type: 'phone',
                type_label: l.phone.operator || 'Telefon raqam',
                value:
                  l.phone.formatted_number ||
                  formatPhoneDisplay(l.phone.phone_number) ||
                  l.phone.phone_number,
                owner_name: l.phone.citizen ? this.formatCitizenFullName(l.phone.citizen) : null,
                shared_apps_count: 0,
                role: l.role,
                target_route: `/dossier/phone/${l.phone.id}`,
              },
            });
          }
          clueMap.get(key)!.apps.add(l.application_id);
        }
      }

      if (l.identifier) {
        const key = `identifier:${l.identifier.id}`;
        if (!excludeKeys.has(key)) {
          if (!clueMap.has(key)) {
            clueMap.set(key, {
              apps: new Set(),
              item: {
                id: l.identifier.id,
                entity_type: 'identifier',
                type_label: l.identifier.type_label || getIdentifierTypeLabel(l.identifier.type),
                value: l.identifier.raw_value,
                owner_name: l.identifier.citizen
                  ? this.formatCitizenFullName(l.identifier.citizen)
                  : null,
                shared_apps_count: 0,
                role: l.role,
                target_route: `/dossier/identifier/${l.identifier.id}`,
              },
            });
          }
          clueMap.get(key)!.apps.add(l.application_id);
        }
      }
    }

    return Array.from(clueMap.values())
      .map((entry) => ({
        ...entry.item,
        shared_apps_count: entry.apps.size,
      }))
      .sort((a, b) => b.shared_apps_count - a.shared_apps_count)
      .slice(0, 30);
  }

  private toDossierAppItem(
    app: Application,
    role: EntityLinkRole,
    source: string,
    reasons: string[],
    permCtx: { canMutate: boolean; isDistrictOfficer: boolean; assignedDistrictIds: string[] },
  ): DossierApplicationItem {
    const isRestrictedCrossDistrict =
      permCtx.isDistrictOfficer &&
      (!app.district_id || !permCtx.assignedDistrictIds.includes(app.district_id));

    return {
      id: app.id,
      application_number: isRestrictedCrossDistrict
        ? 'Boshqa tuman arizasi'
        : app.application_number || 'Raqamsiz',
      description: isRestrictedCrossDistrict
        ? 'Boshqa tuman yurituvidagi ariza (maxfiy tafsilotlar yopiq)'
        : app.description || null,
      officer_notes: isRestrictedCrossDistrict ? null : app.officer_notes || null,
      status: app.status,
      status_label: app.application_status?.name || app.status || 'YANGI',
      status_color: app.application_status?.color || '#3b82f6',
      date: app.date ? new Date(app.date).toISOString() : app.created_at.toISOString(),
      district_id: app.district_id,
      district_name: app.district?.name || null,
      crime_article: app.crime?.article || null,
      crime_method: app.crime_method?.name || null,
      victim_name: isRestrictedCrossDistrict
        ? 'Boshqa tuman fuqarosi'
        : app.citizen
          ? this.formatCitizenFullName(app.citizen)
          : null,
      victim_phone: isRestrictedCrossDistrict ? null : app.citizen?.phone_number || null,
      role_in_app: role,
      link_source: source,
      match_reasons: reasons,
      transfer_amount: app.transfer?.amount ? Number(app.transfer.amount) : null,
      currency: app.transfer?.currency || 'UZS',
      payment_provider: app.transfer?.payment_provider?.name || null,
      can_edit: this.canEditApp(app.district_id, permCtx),
    };
  }

  private mapTransfersForCardSet(
    rawTransfers: Transfer[],
    ownedCardIds: Set<string>,
    opts?: {
      ownedIdentifierId?: string | null;
      defaultDirection?: DossierTransferItem['direction'];
    },
  ): DossierTransferItem[] {
    return rawTransfers.map((tr) => {
      const sOwned = tr.sender_card_id ? ownedCardIds.has(tr.sender_card_id) : false;
      const rOwned =
        (tr.receiver_card_id ? ownedCardIds.has(tr.receiver_card_id) : false) ||
        Boolean(opts?.ownedIdentifierId && tr.receiver_identifier_id === opts.ownedIdentifierId);
      const direction: DossierTransferItem['direction'] =
        sOwned && rOwned
          ? 'INTERNAL'
          : rOwned
            ? 'INCOMING'
            : sOwned
              ? 'OUTGOING'
              : opts?.defaultDirection || 'INTERNAL';

      const images: string[] = [];
      for (const cf of tr.custom_fields || []) {
        if (String(cf.type || '') === 'IMAGES') {
          if (Array.isArray(cf.value)) {
            cf.value.forEach((v) => typeof v === 'string' && images.push(v));
          } else if (typeof cf.value === 'string') {
            images.push(cf.value);
          }
        }
      }

      return {
        id: tr.id,
        transaction_id: tr.transaction_id,
        direction,
        amount: Number(tr.amount || 0),
        currency: tr.currency || 'UZS',
        transfer_date: tr.transfer_date || (tr.created_at ? tr.created_at.toISOString() : null),
        transfer_time: tr.transfer_time || null,
        payment_provider: tr.payment_provider?.name || null,
        sender_card_id: tr.sender_card_id,
        sender_card_number: tr.sender_card
          ? this.formatCardDisplay(tr.sender_card.card_number, tr.sender_card.masked_number)
          : null,
        sender_owner_name: tr.sender_card?.citizen
          ? this.formatCitizenFullName(tr.sender_card.citizen)
          : tr.sender_card?.full_name || null,
        receiver_card_id: tr.receiver_card_id,
        receiver_card_number: tr.receiver_card
          ? this.formatCardDisplay(tr.receiver_card.card_number, tr.receiver_card.masked_number)
          : null,
        receiver_owner_name: tr.receiver_card?.citizen
          ? this.formatCitizenFullName(tr.receiver_card.citizen)
          : tr.receiver_card?.full_name || null,
        application_id: tr.application_id,
        application_number: tr.application?.application_number || null,
        images,
      };
    });
  }

  // ===========================================================================
  // 4. FUQARO 360° TAHLILIY DOSYESI (GET /intelligence/dossier/citizen/:id)
  // ===========================================================================

  async getCitizenDossier(
    citizenId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<FullDossierResponse> {
    const citizen = await this.citizenRepo.findOne({
      where: { id: citizenId },
      relations: {
        district: true,
        neighborhood: true,
        occupation_category: true,
        occupation: true,
        workplace: {
          district: true,
          neighborhood: true,
          occupation_category: true,
        },
      },
    });

    if (!citizen) {
      throw new NotFoundException(`Fuqaro (ID: ${citizenId}) topilmadi`);
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);

    const [ownedCards, ownedPhones, ownedIdentifiers] = await Promise.all([
      this.cardRepo.find({
        where: { citizen_id: citizen.id },
        relations: { bank: true, citizen: true },
        order: { created_at: 'DESC' },
      }),
      this.phoneRepo.find({
        where: { citizen_id: citizen.id },
        order: { is_primary: 'DESC', created_at: 'DESC' },
      }),
      this.identifierRepo.find({
        where: { citizen_id: citizen.id },
        order: { created_at: 'DESC' },
      }),
    ]);

    const cardIds = ownedCards.map((c) => c.id);
    const phoneIds = ownedPhones.map((p) => p.id);
    const identIds = ownedIdentifiers.map((i) => i.id);

    // Tier 1: Aniq bog'langan arizalar (Fuqaro + uning barcha kartalari, telefonlari va raqamli izlari bo'yicha)
    const directLinks = await this.linkRepo.find({
      where: [
        { citizen_id: citizen.id },
        ...(cardIds.length ? [{ card_id: In(cardIds) }] : []),
        ...(phoneIds.length ? [{ phone_id: In(phoneIds) }] : []),
        ...(identIds.length ? [{ identifier_id: In(identIds) }] : []),
      ],
      relations: { card: true, phone: true, identifier: true },
    });

    const appReasonsMap = new Map<
      string,
      { role: EntityLinkRole; source: string; reasons: Set<string> }
    >();

    const rolePriority: Record<EntityLinkRole, number> = {
      SUSPECT: 5,
      DROPPER: 4,
      TRANSIT: 3,
      VICTIM: 2,
      WITNESS: 1,
      RELATED: 0,
    };

    for (const l of directLinks) {
      if (!appReasonsMap.has(l.application_id)) {
        appReasonsMap.set(l.application_id, {
          role: l.role,
          source: l.source,
          reasons: new Set(),
        });
      }
      const entry = appReasonsMap.get(l.application_id)!;
      if (rolePriority[l.role] > rolePriority[entry.role]) {
        entry.role = l.role;
      }
      if (l.source !== 'AUTO_SYNC') {
        entry.source = l.source;
      }

      if (l.card) {
        entry.reasons.add(
          `Karta: ${this.formatCardDisplay(l.card.card_number, l.card.masked_number)} (${l.role})`,
        );
      } else if (l.phone) {
        entry.reasons.add(
          `Telefon: ${l.phone.formatted_number || l.phone.phone_number} (${l.role})`,
        );
      } else if (l.identifier) {
        entry.reasons.add(
          `${l.identifier.type_label || l.identifier.type}: ${l.identifier.raw_value}`,
        );
      } else {
        entry.reasons.add(l.note || 'Fuqaro profili biriktirilgan');
      }
    }

    const directAppIds = Array.from(appReasonsMap.keys());
    const directAppEntities = await this.loadDetailedApplications(directAppIds);

    const directApplications: DossierApplicationItem[] = directAppEntities.map((app) => {
      const meta = appReasonsMap.get(app.id)!;
      return this.toDossierAppItem(app, meta.role, meta.source, Array.from(meta.reasons), permCtx);
    });

    // Fuqaroning kartalaridagi barcha Kirim/Chiqim O'tkazmalar
    const rawTransfers = cardIds.length
      ? await this.transferRepo.find({
          where: [
            { sender_card_id: In(cardIds) },
            { receiver_card_id: In(cardIds) },
            { card_id: In(cardIds) },
          ],
          relations: {
            payment_provider: true,
            sender_card: { bank: true, citizen: true },
            receiver_card: { bank: true, citizen: true },
            application: true,
            custom_fields: true,
          },
          order: { created_at: 'DESC' },
        })
      : [];

    const ownedCardSet = new Set(cardIds);
    const transfers = this.mapTransfersForCardSet(rawTransfers, ownedCardSet);

    // Tier 2: Zanjirli (2-3 qadamli) bog'liqliklar (Counterparty kartalar va ularning egalari orqali)
    const counterpartyCardIds = new Set<string>();
    const cardToViaCard = new Map<string, Card>();

    for (const tr of rawTransfers) {
      if (tr.sender_card_id && !ownedCardSet.has(tr.sender_card_id) && tr.receiver_card) {
        counterpartyCardIds.add(tr.sender_card_id);
        cardToViaCard.set(tr.sender_card_id, tr.receiver_card);
      }
      if (tr.receiver_card_id && !ownedCardSet.has(tr.receiver_card_id) && tr.sender_card) {
        counterpartyCardIds.add(tr.receiver_card_id);
        cardToViaCard.set(tr.receiver_card_id, tr.sender_card);
      }
    }

    const multiHopChains: MultiHopChainItem[] = [];
    if (counterpartyCardIds.size > 0) {
      const hopLinks = await this.linkRepo.find({
        where: { card_id: In(Array.from(counterpartyCardIds)) },
        relations: { card: { citizen: true } },
      });

      const hopAppIds = Array.from(
        new Set(hopLinks.map((hl) => hl.application_id).filter((aid) => !appReasonsMap.has(aid))),
      );

      if (hopAppIds.length > 0) {
        const hopApps = await this.loadDetailedApplications(hopAppIds);
        const hopAppMap = new Map(hopApps.map((a) => [a.id, a]));

        for (const hl of hopLinks) {
          if (appReasonsMap.has(hl.application_id)) continue;
          const targetApp = hopAppMap.get(hl.application_id);
          if (!targetApp || !hl.card) continue;
          if (multiHopChains.some((m) => m.target_application.id === targetApp.id)) continue;

          const ownCard = cardToViaCard.get(hl.card.id);
          const ownCardLabel = ownCard
            ? this.formatCardDisplay(ownCard.card_number, ownCard.masked_number)
            : 'Fuqaro kartasi';
          const cpLabel = this.formatCardDisplay(hl.card.card_number, hl.card.masked_number);

          multiHopChains.push({
            target_application: this.toDossierAppItem(
              targetApp,
              hl.role,
              'MULTI_HOP',
              [`Tranzit zanjir: ${ownCardLabel} ➔ ${cpLabel}`],
              permCtx,
            ),
            hops_count: 2,
            chain_steps: [
              this.formatCitizenFullName(citizen),
              ownCardLabel,
              cpLabel,
              `Ariza № ${targetApp.application_number || 'Raqamsiz'}`,
            ],
            intermediate_entities: [
              {
                type: 'card',
                label: cpLabel,
                route: `/cards/${hl.card.id}`,
              },
            ],
          });
        }
      }
    }

    // Tier 3: Ehtimoliy mosliklar (Karta full_name === Fuqaro F.I.O, lekin citizen_id biriktirilmagan!)
    const probableMatches: ProbableMatchItem[] = [];
    const nameTokens = (citizen.full_name || '')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    if (nameTokens.length >= 2) {
      const t0Raw = nameTokens[0];
      const t1Raw = nameTokens[1];
      const fNorm = this.normalizePersonName(t1Raw);
      const lNorm = this.normalizePersonName(t0Raw);

      if (fNorm.length >= 2 && lNorm.length >= 2) {
        const unlinkedCards = await this.cardRepo.find({
          where: [
            { citizen_id: IsNull(), full_name: ILike(`%${t0Raw}%`) },
            { citizen_id: IsNull(), full_name: ILike(`%${t1Raw}%`) },
          ],
          relations: { bank: true },
          take: 30,
        });

        for (const uc of unlinkedCards) {
          const ucNorm = this.normalizePersonName(uc.full_name);
          if (ucNorm.includes(fNorm) && ucNorm.includes(lNorm)) {
            const ucLinks = await this.linkRepo.find({
              where: { card_id: uc.id },
              relations: { application: { transfer: true } },
            });
            const validLinks = ucLinks.filter((l) => l.application && !l.application.is_deleted);
            const loss = validLinks.reduce(
              (s, l) => s + Number(l.application?.transfer?.amount || 0),
              0,
            );

            probableMatches.push({
              id: `prob_card_${uc.id}`,
              match_type: 'CARD_OWNER_NAME',
              confidence: 88,
              title: this.formatCardDisplay(uc.card_number, uc.masked_number),
              subtitle: `Kartadagi F.I.O: "${uc.full_name}" · ${uc.bank?.name || 'Bank'}`,
              reason: `Plastik kartada yozilgan "${uc.full_name}" ismi ushbu fuqaroning F.I.Sh. bilan mos kelmoqda, ammo karta profilga rasman biriktirilmagan.`,
              target_entity_type: 'card',
              target_entity_id: uc.id,
              target_route: `/cards/${uc.id}`,
              linked_apps_count: new Set(validLinks.map((l) => l.application_id)).size,
              total_amount: loss,
              confirm_action: {
                action_type: 'BIND_CARD_TO_CITIZEN',
                citizen_id: citizen.id,
                card_id: uc.id,
              },
            });
          }
        }
      }
    }

    // Co-occurring clues
    const excludeSet = new Set<string>([
      `citizen:${citizen.id}`,
      ...cardIds.map((id) => `card:${id}`),
      ...phoneIds.map((id) => `phone:${id}`),
      ...identIds.map((id) => `identifier:${id}`),
    ]);
    const coOccurringClues = await this.computeCoOccurringClues(directAppIds, excludeSet);
    const evidenceFiles = this.extractEvidenceFiles(directAppEntities);
    const stats = this.buildMicroStats(directApplications, transfers);

    // Ikki rejimli Graf: 1) To'liq Bog'liqliklar Xaritasi (NetworkGraph), 2) Moliyaviy Oqim (FinancialGraph)
    const networkGraph = this.buildCitizenNetworkGraph(
      citizen,
      stats,
      ownedCards,
      ownedPhones,
      ownedIdentifiers,
      directApplications,
      probableMatches,
      rawTransfers,
    );

    const allGraphCards = [
      ...ownedCards,
      ...rawTransfers.map((t) => t.sender_card).filter((c): c is Card => Boolean(c)),
      ...rawTransfers.map((t) => t.receiver_card).filter((c): c is Card => Boolean(c)),
    ];
    const financialGraph = this.buildFinancialSubgraph(allGraphCards, rawTransfers, ownedCardSet);

    return {
      entityType: 'citizen',
      canMutate: permCtx.canMutate,
      citizen: citizen as unknown as Record<string, unknown>,
      ownedCards: ownedCards as unknown as Record<string, unknown>[],
      ownedPhones: ownedPhones as unknown as Record<string, unknown>[],
      ownedIdentifiers: ownedIdentifiers as unknown as Record<string, unknown>[],
      stats,
      directApplications,
      multiHopChains,
      probableMatches,
      transfers,
      coOccurringClues,
      evidenceFiles,
      networkGraph,
      financialGraph,
    };
  }

  private buildCitizenNetworkGraph(
    citizen: Citizen,
    stats: DossierMicroStats,
    cards: Card[],
    phones: PhoneEntity[],
    identifiers: DigitalIdentifierEntity[],
    apps: DossierApplicationItem[],
    probableMatches: ProbableMatchItem[],
    transfers: Transfer[],
  ): INetworkGraph {
    const nodes = new Map<string, INetworkNode>();
    const edges: INetworkEdge[] = [];

    const centerId = `citizen:${citizen.id}`;
    nodes.set(centerId, {
      id: centerId,
      entityId: citizen.id,
      nodeType: 'CITIZEN',
      label: this.formatCitizenFullName(citizen),
      sublabel: citizen.pinfl ? `JSHSHIR: ${citizen.pinfl}` : citizen.passport || 'Fuqaro',
      role: stats.isCrossRoleCollision
        ? 'MIXED'
        : stats.suspectOrDropperAppsCount > 0
          ? 'DROPPER'
          : 'VICTIM',
      riskScore: stats.riskScore,
      appsCount: stats.totalApplications,
      isCenter: true,
      targetRoute: `/citizens/${citizen.id}`,
    });

    for (const c of cards) {
      const nid = `card:${c.id}`;
      nodes.set(nid, {
        id: nid,
        entityId: c.id,
        nodeType: 'CARD',
        label: this.formatCardDisplay(c.card_number, c.masked_number),
        sublabel: c.bank?.name || this.financialFlowService.identifyBank(c.card_number || ''),
        role: stats.suspectOrDropperAppsCount > 0 ? 'DROPPER' : 'VICTIM',
        riskScore: stats.riskScore,
        appsCount: 0,
        targetRoute: `/cards/${c.id}`,
      });
      edges.push({
        id: `e_${centerId}_${nid}`,
        from: centerId,
        to: nid,
        relationType: 'OWNERSHIP',
        label: 'Karta egasi',
      });
    }

    for (const p of phones) {
      const nid = `phone:${p.id}`;
      nodes.set(nid, {
        id: nid,
        entityId: p.id,
        nodeType: 'PHONE',
        label: p.formatted_number || formatPhoneDisplay(p.phone_number) || p.phone_number,
        sublabel: p.operator || 'Telefon',
        role: 'NEUTRAL',
        riskScore: 20,
        appsCount: 0,
        targetRoute: `/dossier/phone/${p.id}`,
      });
      edges.push({
        id: `e_${centerId}_${nid}`,
        from: centerId,
        to: nid,
        relationType: 'OWNERSHIP',
        label: p.is_primary ? 'Asosiy raqam' : p.label || 'Qoʻshimcha raqam',
      });
    }

    for (const ident of identifiers) {
      const nid = `identifier:${ident.id}`;
      nodes.set(nid, {
        id: nid,
        entityId: ident.id,
        nodeType: 'IDENTIFIER',
        label: ident.raw_value,
        sublabel: ident.type_label || ident.type,
        role: 'SUSPECT',
        riskScore: 70,
        appsCount: 0,
        targetRoute: `/dossier/identifier/${ident.id}`,
      });
      edges.push({
        id: `e_${centerId}_${nid}`,
        from: centerId,
        to: nid,
        relationType: 'OWNERSHIP',
        label: ident.type_label || 'Raqamli iz',
      });
    }

    for (const a of apps) {
      const nid = `application:${a.id}`;
      nodes.set(nid, {
        id: nid,
        entityId: a.id,
        nodeType: 'APPLICATION',
        label: `№ ${a.application_number}`,
        sublabel: a.district_name || a.status_label,
        role: 'APPLICATION',
        riskScore: 0,
        appsCount: 1,
        amount: a.transfer_amount || 0,
        targetRoute: `/applications/${a.id}`,
      });
      edges.push({
        id: `e_${centerId}_${nid}`,
        from: centerId,
        to: nid,
        relationType:
          a.role_in_app === 'SUSPECT' || a.role_in_app === 'DROPPER'
            ? 'SUSPECT_CLUE'
            : 'VICTIM_LINK',
        label:
          a.role_in_app === 'DROPPER'
            ? 'Dropper'
            : a.role_in_app === 'SUSPECT'
              ? 'Gumonlanuvchi'
              : 'Jabrlanuvchi',
        amount: a.transfer_amount || undefined,
      });
    }

    // Counterparty transfer cards on graph
    for (const tr of transfers.slice(0, 20)) {
      if (tr.sender_card && tr.receiver_card && tr.sender_card.id !== tr.receiver_card.id) {
        const sId = `card:${tr.sender_card.id}`;
        const rId = `card:${tr.receiver_card.id}`;
        if (!nodes.has(sId)) {
          nodes.set(sId, {
            id: sId,
            entityId: tr.sender_card.id,
            nodeType: 'CARD',
            label: this.formatCardDisplay(tr.sender_card.card_number, tr.sender_card.masked_number),
            sublabel: tr.sender_card.full_name || 'Joʻnatuvchi karta',
            role: 'VICTIM',
            riskScore: 15,
            appsCount: 0,
            targetRoute: `/cards/${tr.sender_card.id}`,
          });
        }
        if (!nodes.has(rId)) {
          nodes.set(rId, {
            id: rId,
            entityId: tr.receiver_card.id,
            nodeType: 'CARD',
            label: this.formatCardDisplay(
              tr.receiver_card.card_number,
              tr.receiver_card.masked_number,
            ),
            sublabel: tr.receiver_card.full_name || 'Qabul qiluvchi karta',
            role: 'DROPPER',
            riskScore: 75,
            appsCount: 0,
            targetRoute: `/cards/${tr.receiver_card.id}`,
          });
        }
        edges.push({
          id: `tr_${tr.id}`,
          from: sId,
          to: rId,
          relationType: 'TRANSFER',
          label: `${new Intl.NumberFormat('uz-UZ').format(Number(tr.amount || 0))} UZS`,
          amount: Number(tr.amount || 0),
        });
      }
    }

    for (const pm of probableMatches.slice(0, 5)) {
      const nid = `${pm.target_entity_type}:${pm.target_entity_id}`;
      if (!nodes.has(nid)) {
        nodes.set(nid, {
          id: nid,
          entityId: pm.target_entity_id,
          nodeType: pm.target_entity_type === 'card' ? 'CARD' : 'CITIZEN',
          label: pm.title,
          sublabel: `Ehtimoliy (${pm.confidence}%)`,
          role: 'TRANSIT',
          riskScore: 50,
          appsCount: pm.linked_apps_count,
          targetRoute: pm.target_route,
        });
        edges.push({
          id: `prob_${pm.id}`,
          from: centerId,
          to: nid,
          relationType: 'PROBABLE_MATCH',
          label: `Ehtimoliy F.I.O (${pm.confidence}%)`,
          isDashed: true,
        });
      }
    }

    return { nodes: Array.from(nodes.values()), edges };
  }

  // ===========================================================================
  // 5. PLASTIK KARTA 360° TAHLILIY DOSYESI (GET /intelligence/dossier/card/:id)
  // ===========================================================================

  async getCardDossier(
    cardId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<FullDossierResponse> {
    const card = await this.cardRepo.findOne({
      where: { id: cardId },
      relations: {
        bank: true,
        citizen: { district: true, neighborhood: true },
      },
    });

    if (!card) {
      throw new NotFoundException(`Karta (ID: ${cardId}) topilmadi`);
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);

    const directLinks = await this.linkRepo.find({
      where: { card_id: card.id },
    });

    const rolePriority: Record<EntityLinkRole, number> = {
      SUSPECT: 5,
      DROPPER: 4,
      TRANSIT: 3,
      VICTIM: 2,
      WITNESS: 1,
      RELATED: 0,
    };

    const appRoleMap = new Map<string, { role: EntityLinkRole; source: string; note?: string }>();
    for (const l of directLinks) {
      const existing = appRoleMap.get(l.application_id);
      if (!existing || rolePriority[l.role] > rolePriority[existing.role]) {
        appRoleMap.set(l.application_id, {
          role: l.role,
          source: l.source,
          note: l.note || existing?.note || undefined,
        });
      }
    }

    const rawTransfers = await this.transferRepo.find({
      where: [{ sender_card_id: card.id }, { receiver_card_id: card.id }, { card_id: card.id }],
      relations: {
        payment_provider: true,
        sender_card: { bank: true, citizen: true },
        receiver_card: { bank: true, citizen: true },
        application: true,
        custom_fields: true,
      },
      order: { created_at: 'DESC' },
    });

    for (const tr of rawTransfers) {
      if (tr.application_id && !appRoleMap.has(tr.application_id)) {
        appRoleMap.set(tr.application_id, {
          role: tr.receiver_card_id === card.id ? 'DROPPER' : 'VICTIM',
          source: 'TRANSFER',
        });
      }
    }

    const directAppIds = Array.from(appRoleMap.keys());
    const directAppEntities = await this.loadDetailedApplications(directAppIds);
    const directApplications = directAppEntities.map((app) => {
      const m = appRoleMap.get(app.id)!;
      return this.toDossierAppItem(
        app,
        m.role,
        m.source,
        [m.note || (m.role === 'DROPPER' ? 'Qabul qiluvchi karta' : 'Joʻnatuvchi karta')],
        permCtx,
      );
    });

    const cardSet = new Set([card.id]);
    const transfers = this.mapTransfersForCardSet(rawTransfers, cardSet);

    // Tier 2: Karta egasi (Citizen) ning BOSHQA kartalari yoki Counterparty kartalar orqali zanjirlar!
    const multiHopChains: MultiHopChainItem[] = [];
    let siblingCards: Card[] = [];
    let ownerPhones: PhoneEntity[] = [];
    let ownerIdentifiers: DigitalIdentifierEntity[] = [];

    if (card.citizen_id) {
      const [sCards, oPhones, oIdents] = await Promise.all([
        this.cardRepo.find({
          where: { citizen_id: card.citizen_id, id: Not(card.id) },
          relations: { bank: true },
        }),
        this.phoneRepo.find({ where: { citizen_id: card.citizen_id } }),
        this.identifierRepo.find({ where: { citizen_id: card.citizen_id } }),
      ]);
      siblingCards = sCards;
      ownerPhones = oPhones;
      ownerIdentifiers = oIdents;

      const siblingCardIds = siblingCards.map((sc) => sc.id);
      if (siblingCardIds.length > 0) {
        const sibLinks = await this.linkRepo.find({
          where: { card_id: In(siblingCardIds) },
          relations: { card: true },
        });
        const newAppIds = Array.from(
          new Set(sibLinks.map((sl) => sl.application_id).filter((aid) => !appRoleMap.has(aid))),
        );
        const newApps = await this.loadDetailedApplications(newAppIds);
        const newAppMap = new Map(newApps.map((a) => [a.id, a]));

        for (const sl of sibLinks) {
          const tApp = newAppMap.get(sl.application_id);
          if (!tApp || !sl.card) continue;
          if (multiHopChains.some((c) => c.target_application.id === tApp.id)) continue;

          const sibLabel = this.formatCardDisplay(sl.card.card_number, sl.card.masked_number);
          multiHopChains.push({
            target_application: this.toDossierAppItem(
              tApp,
              sl.role,
              'MULTI_HOP',
              [`Karta egasining boshqa kartasi (${sibLabel}) orqali bogʻlangan`],
              permCtx,
            ),
            hops_count: 2,
            chain_steps: [
              this.formatCardDisplay(card.card_number, card.masked_number),
              `Fuqaro: ${this.formatCitizenFullName(card.citizen)}`,
              sibLabel,
              `Ariza № ${tApp.application_number || 'Raqamsiz'}`,
            ],
            intermediate_entities: [
              {
                type: 'citizen',
                label: this.formatCitizenFullName(card.citizen),
                route: `/citizens/${card.citizen_id}`,
              },
              {
                type: 'card',
                label: sibLabel,
                route: `/cards/${sl.card.id}`,
              },
            ],
          });
        }
      }
    }

    // Tier 3: Agar kartada citizen_id yo'q bo'lsa-yu, full_name yozilgan bo'lsa — bazadagi Fuqarolardan mosini qidirish!
    const probableMatches: ProbableMatchItem[] = [];
    if (!card.citizen_id && card.full_name) {
      const parts = card.full_name
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      if (parts.length >= 2) {
        const candidateCitizens = await this.citizenRepo
          .createQueryBuilder('c')
          .leftJoinAndSelect('c.district', 'district')
          .where('c.full_name ILIKE :p0 AND c.full_name ILIKE :p1', {
            p0: `%${parts[0]}%`,
            p1: `%${parts[1]}%`,
          })
          .take(10)
          .getMany();

        for (const cand of candidateCitizens) {
          probableMatches.push({
            id: `prob_cit_${cand.id}`,
            match_type: 'CARD_OWNER_NAME',
            confidence: 88,
            title: this.formatCitizenFullName(cand),
            subtitle: `${cand.passport ? `Pasport: ${cand.passport} · ` : ''}${cand.phone_number ? formatPhoneDisplay(cand.phone_number) : cand.district?.name || 'Fuqaro'}`,
            reason: `Kartadagi "${card.full_name}" yozuvi bazadagi fuqaro F.I.Sh. bilan mos keldi.`,
            target_entity_type: 'citizen',
            target_entity_id: cand.id,
            target_route: `/citizens/${cand.id}`,
            linked_apps_count: 0,
            total_amount: 0,
            confirm_action: {
              action_type: 'LINK_CITIZEN_TO_CARD',
              citizen_id: cand.id,
              card_id: card.id,
            },
          });
        }
      }
    }

    const excludeSet = new Set([`card:${card.id}`]);
    const coOccurringClues = await this.computeCoOccurringClues(directAppIds, excludeSet);
    const evidenceFiles = this.extractEvidenceFiles(directAppEntities);
    const stats = this.buildMicroStats(directApplications, transfers);

    // Network Graph centered on Card
    const netNodes = new Map<string, INetworkNode>();
    const netEdges: INetworkEdge[] = [];
    const centerId = `card:${card.id}`;
    const cleanCardNum = (card.card_number || '').replace(/\D/g, '');

    netNodes.set(centerId, {
      id: centerId,
      entityId: card.id,
      nodeType: 'CARD',
      label: this.formatCardDisplay(card.card_number, card.masked_number),
      sublabel: card.bank?.name || this.financialFlowService.identifyBank(cleanCardNum),
      role: stats.suspectOrDropperAppsCount > 0 ? 'DROPPER' : 'VICTIM',
      riskScore: stats.riskScore,
      appsCount: stats.totalApplications,
      isCenter: true,
      targetRoute: `/cards/${card.id}`,
    });

    if (card.citizen) {
      const citNodeId = `citizen:${card.citizen.id}`;
      netNodes.set(citNodeId, {
        id: citNodeId,
        entityId: card.citizen.id,
        nodeType: 'CITIZEN',
        label: this.formatCitizenFullName(card.citizen),
        sublabel: card.citizen.passport || 'Karta egasi',
        role: stats.suspectOrDropperAppsCount > 0 ? 'DROPPER' : 'VICTIM',
        riskScore: stats.riskScore,
        appsCount: stats.totalApplications,
        targetRoute: `/citizens/${card.citizen.id}`,
      });
      netEdges.push({
        id: `e_${citNodeId}_${centerId}`,
        from: citNodeId,
        to: centerId,
        relationType: 'OWNERSHIP',
        label: 'Karta egasi',
      });
    }

    for (const a of directApplications) {
      const aid = `application:${a.id}`;
      netNodes.set(aid, {
        id: aid,
        entityId: a.id,
        nodeType: 'APPLICATION',
        label: `№ ${a.application_number}`,
        sublabel: a.district_name || a.status_label,
        role: 'APPLICATION',
        riskScore: 0,
        appsCount: 1,
        amount: a.transfer_amount || 0,
        targetRoute: `/applications/${a.id}`,
      });
      netEdges.push({
        id: `e_${centerId}_${aid}`,
        from: centerId,
        to: aid,
        relationType:
          a.role_in_app === 'DROPPER' || a.role_in_app === 'SUSPECT'
            ? 'SUSPECT_CLUE'
            : 'VICTIM_LINK',
        label: a.role_in_app === 'DROPPER' ? 'Pul olgan (Dropper)' : 'Jabrlanuvchi kartasi',
      });
    }

    for (const tr of rawTransfers.slice(0, 25)) {
      const otherCard = tr.sender_card_id === card.id ? tr.receiver_card : tr.sender_card;
      if (otherCard && otherCard.id !== card.id) {
        const oid = `card:${otherCard.id}`;
        if (!netNodes.has(oid)) {
          netNodes.set(oid, {
            id: oid,
            entityId: otherCard.id,
            nodeType: 'CARD',
            label: this.formatCardDisplay(otherCard.card_number, otherCard.masked_number),
            sublabel: otherCard.full_name || 'Kontragent karta',
            role: tr.sender_card_id === card.id ? 'DROPPER' : 'VICTIM',
            riskScore: tr.sender_card_id === card.id ? 75 : 20,
            appsCount: 0,
            targetRoute: `/cards/${otherCard.id}`,
          });
        }
        netEdges.push({
          id: `tr_${tr.id}`,
          from: tr.sender_card_id === card.id ? centerId : oid,
          to: tr.sender_card_id === card.id ? oid : centerId,
          relationType: 'TRANSFER',
          label: `${new Intl.NumberFormat('uz-UZ').format(Number(tr.amount || 0))} UZS`,
          amount: Number(tr.amount || 0),
        });
      }
    }

    const allGraphCards = [
      card,
      ...siblingCards,
      ...rawTransfers.map((t) => t.sender_card).filter((c): c is Card => Boolean(c)),
      ...rawTransfers.map((t) => t.receiver_card).filter((c): c is Card => Boolean(c)),
    ];
    const financialGraph = this.buildFinancialSubgraph(allGraphCards, rawTransfers, cardSet);

    return {
      entityType: 'card',
      canMutate: permCtx.canMutate,
      card: {
        ...card,
        inferred_bank_name: card.bank?.name || this.financialFlowService.identifyBank(cleanCardNum),
      } as unknown as Record<string, unknown>,
      citizen: (card.citizen as unknown as Record<string, unknown>) || null,
      ownedCards: siblingCards as unknown as Record<string, unknown>[],
      ownedPhones: ownerPhones as unknown as Record<string, unknown>[],
      ownedIdentifiers: ownerIdentifiers as unknown as Record<string, unknown>[],
      stats,
      directApplications,
      multiHopChains,
      probableMatches,
      transfers,
      coOccurringClues,
      evidenceFiles,
      networkGraph: { nodes: Array.from(netNodes.values()), edges: netEdges },
      financialGraph,
    };
  }

  // ===========================================================================
  // 6. TELEFON VA RAQAMLI IZLAR 360° DOSYESI (GET /intelligence/dossier/phone|:id)
  // ===========================================================================

  async getPhoneDossier(
    phoneId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<FullDossierResponse> {
    const phone = await this.phoneRepo.findOne({
      where: { id: phoneId },
      relations: { citizen: { district: true, neighborhood: true } },
    });
    if (!phone) {
      throw new NotFoundException(`Telefon raqam (ID: ${phoneId}) topilmadi`);
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);
    const links = await this.linkRepo.find({ where: { phone_id: phone.id } });

    const rolePriority: Record<EntityLinkRole, number> = {
      SUSPECT: 5,
      DROPPER: 4,
      TRANSIT: 3,
      VICTIM: 2,
      WITNESS: 1,
      RELATED: 0,
    };

    const appRoleMap = new Map<string, { role: EntityLinkRole; source: string; note?: string }>();
    for (const l of links) {
      const existing = appRoleMap.get(l.application_id);
      if (!existing || rolePriority[l.role] > rolePriority[existing.role]) {
        appRoleMap.set(l.application_id, {
          role: l.role,
          source: l.source,
          note: l.note || existing?.note || undefined,
        });
      }
    }

    const directAppIds = Array.from(appRoleMap.keys());
    const directAppEntities = await this.loadDetailedApplications(directAppIds);
    const directApplications = directAppEntities.map((app) => {
      const m = appRoleMap.get(app.id)!;
      return this.toDossierAppItem(
        app,
        m.role,
        m.source,
        [m.note || `Telefon raqami (${phone.formatted_number || phone.phone_number})`],
        permCtx,
      );
    });

    let ownedCards: Card[] = [];
    let ownedPhones: PhoneEntity[] = [];
    let ownedIdentifiers: DigitalIdentifierEntity[] = [];
    let rawTransfers: Transfer[] = [];

    if (phone.citizen_id) {
      [ownedCards, ownedPhones, ownedIdentifiers] = await Promise.all([
        this.cardRepo.find({
          where: { citizen_id: phone.citizen_id },
          relations: { bank: true, citizen: true },
        }),
        this.phoneRepo.find({ where: { citizen_id: phone.citizen_id } }),
        this.identifierRepo.find({ where: { citizen_id: phone.citizen_id } }),
      ]);
      const cIds = ownedCards.map((c) => c.id);
      if (cIds.length > 0) {
        rawTransfers = await this.transferRepo.find({
          where: [{ sender_card_id: In(cIds) }, { receiver_card_id: In(cIds) }],
          relations: {
            payment_provider: true,
            sender_card: { bank: true, citizen: true },
            receiver_card: { bank: true, citizen: true },
            application: true,
          },
          order: { created_at: 'DESC' },
        });
      }
    } else {
      // Arizalardagi o'tkazmalarni ko'rsatish
      rawTransfers = directAppEntities
        .map((a) => a.transfer)
        .filter((t): t is Transfer => Boolean(t));
    }

    const cardSet = new Set(ownedCards.map((c) => c.id));
    const hasSuspectPhoneRole = directApplications.some(
      (a) => a.role_in_app === 'SUSPECT' || a.role_in_app === 'DROPPER',
    );
    const transfers = this.mapTransfersForCardSet(rawTransfers, cardSet, {
      defaultDirection: hasSuspectPhoneRole ? 'INCOMING' : 'OUTGOING',
    });
    const coOccurringClues = await this.computeCoOccurringClues(
      directAppIds,
      new Set([`phone:${phone.id}`]),
    );
    const evidenceFiles = this.extractEvidenceFiles(directAppEntities);
    const stats = this.buildMicroStats(directApplications, transfers);

    const netNodes = new Map<string, INetworkNode>();
    const netEdges: INetworkEdge[] = [];
    const centerId = `phone:${phone.id}`;

    netNodes.set(centerId, {
      id: centerId,
      entityId: phone.id,
      nodeType: 'PHONE',
      label: phone.formatted_number || formatPhoneDisplay(phone.phone_number) || phone.phone_number,
      sublabel: phone.operator || 'Telefon',
      role: stats.suspectOrDropperAppsCount > 0 ? 'SUSPECT' : 'VICTIM',
      riskScore: stats.riskScore,
      appsCount: stats.totalApplications,
      isCenter: true,
      targetRoute: `/dossier/phone/${phone.id}`,
    });

    if (phone.citizen) {
      const cid = `citizen:${phone.citizen.id}`;
      netNodes.set(cid, {
        id: cid,
        entityId: phone.citizen.id,
        nodeType: 'CITIZEN',
        label: this.formatCitizenFullName(phone.citizen),
        sublabel: 'Raqam egasi',
        role: stats.suspectOrDropperAppsCount > 0 ? 'SUSPECT' : 'VICTIM',
        riskScore: stats.riskScore,
        appsCount: stats.totalApplications,
        targetRoute: `/citizens/${phone.citizen.id}`,
      });
      netEdges.push({
        id: `e_${cid}_${centerId}`,
        from: cid,
        to: centerId,
        relationType: 'OWNERSHIP',
        label: 'Raqam egasi',
      });
    }

    for (const a of directApplications) {
      const aid = `application:${a.id}`;
      netNodes.set(aid, {
        id: aid,
        entityId: a.id,
        nodeType: 'APPLICATION',
        label: `№ ${a.application_number}`,
        sublabel: a.district_name || a.status_label,
        role: 'APPLICATION',
        riskScore: 0,
        appsCount: 1,
        amount: a.transfer_amount || 0,
        targetRoute: `/applications/${a.id}`,
      });
      netEdges.push({
        id: `e_${centerId}_${aid}`,
        from: centerId,
        to: aid,
        relationType: a.role_in_app === 'SUSPECT' ? 'SUSPECT_CLUE' : 'VICTIM_LINK',
        label: a.role_in_app === 'SUSPECT' ? 'Gumonlanuvchi raqami' : 'Jabrlanuvchi raqami',
      });
    }

    for (const clue of coOccurringClues.slice(0, 12)) {
      const cid = `${clue.entity_type}:${clue.id}`;
      if (!netNodes.has(cid)) {
        netNodes.set(cid, {
          id: cid,
          entityId: clue.id,
          nodeType:
            clue.entity_type === 'card'
              ? 'CARD'
              : clue.entity_type === 'phone'
                ? 'PHONE'
                : 'IDENTIFIER',
          label: clue.value,
          sublabel: clue.type_label,
          role: 'SUSPECT',
          riskScore: 65,
          appsCount: clue.shared_apps_count,
          targetRoute: clue.target_route,
        });
        netEdges.push({
          id: `co_${centerId}_${cid}`,
          from: centerId,
          to: cid,
          relationType: 'SUSPECT_CLUE',
          label: `${clue.shared_apps_count} ta ishda birga`,
          isDashed: true,
        });
      }
    }

    const allGraphCards = [
      ...ownedCards,
      ...rawTransfers.map((t) => t.sender_card).filter((c): c is Card => Boolean(c)),
      ...rawTransfers.map((t) => t.receiver_card).filter((c): c is Card => Boolean(c)),
    ];

    return {
      entityType: 'phone',
      canMutate: permCtx.canMutate,
      phone: phone as unknown as Record<string, unknown>,
      citizen: (phone.citizen as unknown as Record<string, unknown>) || null,
      ownedCards: ownedCards as unknown as Record<string, unknown>[],
      ownedPhones: ownedPhones as unknown as Record<string, unknown>[],
      ownedIdentifiers: ownedIdentifiers as unknown as Record<string, unknown>[],
      stats,
      directApplications,
      multiHopChains: [],
      probableMatches: [],
      transfers,
      coOccurringClues,
      evidenceFiles,
      networkGraph: { nodes: Array.from(netNodes.values()), edges: netEdges },
      financialGraph: this.buildFinancialSubgraph(allGraphCards, rawTransfers, cardSet),
    };
  }

  async getIdentifierDossier(
    identifierId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<FullDossierResponse> {
    const identifier = await this.identifierRepo.findOne({
      where: { id: identifierId },
      relations: { citizen: { district: true, neighborhood: true } },
    });
    if (!identifier) {
      throw new NotFoundException(`Raqamli identifikator (ID: ${identifierId}) topilmadi`);
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);
    const links = await this.linkRepo.find({ where: { identifier_id: identifier.id } });

    const rolePriority: Record<EntityLinkRole, number> = {
      SUSPECT: 5,
      DROPPER: 4,
      TRANSIT: 3,
      VICTIM: 2,
      WITNESS: 1,
      RELATED: 0,
    };

    const appRoleMap = new Map<string, { role: EntityLinkRole; source: string; note?: string }>();
    for (const l of links) {
      const existing = appRoleMap.get(l.application_id);
      if (!existing || rolePriority[l.role] > rolePriority[existing.role]) {
        appRoleMap.set(l.application_id, {
          role: l.role,
          source: l.source,
          note: l.note || existing?.note || undefined,
        });
      }
    }

    const directAppIds = Array.from(appRoleMap.keys());
    const directAppEntities = await this.loadDetailedApplications(directAppIds);
    const directApplications = directAppEntities.map((app) => {
      const m = appRoleMap.get(app.id)!;
      return this.toDossierAppItem(
        app,
        m.role,
        m.source,
        [m.note || `${identifier.type_label || identifier.type}: ${identifier.raw_value}`],
        permCtx,
      );
    });

    const directIdentTransfers = await this.transferRepo.find({
      where: { receiver_identifier_id: identifier.id },
      relations: {
        payment_provider: true,
        sender_card: { bank: true, citizen: true },
        receiver_card: { bank: true, citizen: true },
        application: true,
        custom_fields: true,
      },
      order: { created_at: 'DESC' },
    });
    const transferById = new Map<string, Transfer>();
    for (const tr of directIdentTransfers) {
      transferById.set(tr.id, tr);
    }
    for (const a of directAppEntities) {
      if (a.transfer && !transferById.has(a.transfer.id)) {
        transferById.set(a.transfer.id, a.transfer);
      }
    }
    const rawTransfers = Array.from(transferById.values());
    const transfers = this.mapTransfersForCardSet(rawTransfers, new Set(), {
      ownedIdentifierId: identifier.id,
      defaultDirection: 'INCOMING',
    });
    const coOccurringClues = await this.computeCoOccurringClues(
      directAppIds,
      new Set([`identifier:${identifier.id}`]),
    );
    const evidenceFiles = this.extractEvidenceFiles(directAppEntities);
    const stats = this.buildMicroStats(directApplications, transfers);

    const netNodes = new Map<string, INetworkNode>();
    const netEdges: INetworkEdge[] = [];
    const centerId = `identifier:${identifier.id}`;

    netNodes.set(centerId, {
      id: centerId,
      entityId: identifier.id,
      nodeType: 'IDENTIFIER',
      label: identifier.raw_value,
      sublabel: identifier.type_label || getIdentifierTypeLabel(identifier.type),
      role: 'SUSPECT',
      riskScore: Math.max(stats.riskScore, 65),
      appsCount: stats.totalApplications,
      isCenter: true,
      targetRoute: `/dossier/identifier/${identifier.id}`,
    });

    if (identifier.citizen) {
      const cid = `citizen:${identifier.citizen.id}`;
      netNodes.set(cid, {
        id: cid,
        entityId: identifier.citizen.id,
        nodeType: 'CITIZEN',
        label: this.formatCitizenFullName(identifier.citizen),
        sublabel: 'Biriktirilgan shaxs',
        role: 'SUSPECT',
        riskScore: stats.riskScore,
        appsCount: stats.totalApplications,
        targetRoute: `/citizens/${identifier.citizen.id}`,
      });
      netEdges.push({
        id: `e_${cid}_${centerId}`,
        from: cid,
        to: centerId,
        relationType: 'OWNERSHIP',
        label: 'Egasi',
      });
    }

    for (const a of directApplications) {
      const aid = `application:${a.id}`;
      netNodes.set(aid, {
        id: aid,
        entityId: a.id,
        nodeType: 'APPLICATION',
        label: `№ ${a.application_number}`,
        sublabel: a.district_name || a.status_label,
        role: 'APPLICATION',
        riskScore: 0,
        appsCount: 1,
        amount: a.transfer_amount || 0,
        targetRoute: `/applications/${a.id}`,
      });
      netEdges.push({
        id: `e_${centerId}_${aid}`,
        from: centerId,
        to: aid,
        relationType: 'SUSPECT_CLUE',
        label: 'Gumonlanuvchi izi',
      });
    }

    for (const clue of coOccurringClues.slice(0, 12)) {
      const cid = `${clue.entity_type}:${clue.id}`;
      if (!netNodes.has(cid)) {
        netNodes.set(cid, {
          id: cid,
          entityId: clue.id,
          nodeType:
            clue.entity_type === 'card'
              ? 'CARD'
              : clue.entity_type === 'phone'
                ? 'PHONE'
                : 'IDENTIFIER',
          label: clue.value,
          sublabel: clue.type_label,
          role: 'SUSPECT',
          riskScore: 70,
          appsCount: clue.shared_apps_count,
          targetRoute: clue.target_route,
        });
        netEdges.push({
          id: `co_${centerId}_${cid}`,
          from: centerId,
          to: cid,
          relationType: 'SUSPECT_CLUE',
          label: `${clue.shared_apps_count} ta ishda birga`,
          isDashed: true,
        });
      }
    }

    const allGraphCards = [
      ...rawTransfers.map((t) => t.sender_card).filter((c): c is Card => Boolean(c)),
      ...rawTransfers.map((t) => t.receiver_card).filter((c): c is Card => Boolean(c)),
    ];

    return {
      entityType: 'identifier',
      canMutate: permCtx.canMutate,
      identifier: identifier as unknown as Record<string, unknown>,
      citizen: (identifier.citizen as unknown as Record<string, unknown>) || null,
      ownedCards: [],
      ownedPhones: [],
      ownedIdentifiers: [],
      stats,
      directApplications,
      multiHopChains: [],
      probableMatches: [],
      transfers,
      coOccurringClues,
      evidenceFiles,
      networkGraph: { nodes: Array.from(netNodes.values()), edges: netEdges },
      financialGraph: this.buildFinancialSubgraph(allGraphCards, rawTransfers, new Set()),
    };
  }

  // ===========================================================================
  // 7. TERGOV AMALLARI: TELEFON, KARTA, IDENTIFIKATOR QO'SHISH & TRANZIT OQIM
  // ===========================================================================

  async addPhoneToCitizen(
    citizenId: string,
    dto: { phone_number: string; label?: string; notes?: string; is_primary?: boolean },
    currentUser?: JwtAccessPayload,
  ) {
    this.assertCanMutate(currentUser);
    const citizen = await this.citizenRepo.findOne({ where: { id: citizenId } });
    if (!citizen) throw new NotFoundException('Fuqaro topilmadi');

    const clean = normalizePhoneDigits(dto.phone_number);
    if (clean.length < 7) {
      throw new BadRequestException('Telefon raqami kamida 7 ta raqamdan iborat boʻlishi kerak');
    }

    const existingBefore = await this.phoneRepo.findOne({ where: { phone_number: clean } });
    this.assertCanReassignOwnership(
      existingBefore?.citizen_id,
      citizen.id,
      'telefon raqami',
      currentUser,
    );
    const phone = await this.syncService.upsertPhone(clean, {
      citizenId: citizen.id,
      isPrimary: dto.is_primary,
      label: dto.label || 'Qoʻshimcha raqam',
      notes: dto.notes || null,
    });

    if (!phone) throw new BadRequestException('Telefon raqamini saqlab boʻlmadi');

    // Agar oldin egasi bo'lmagan bo'lsa yoki boshqaga tegishli bo'lmagan bo'lsa, citizen_id ni yangilaymiz
    if (phone.citizen_id !== citizen.id) {
      phone.citizen_id = citizen.id;
      await this.phoneRepo.save(phone);
    }

    if (dto.is_primary || !citizen.phone_number) {
      citizen.phone_number = clean;
      await this.citizenRepo.save(citizen);
    }

    // Ushbu telefon oldin noma'lum gumonlanuvchi sifatida o'tgan arizalarni avtomatik fuqaroga bog'lash!
    const existingPhoneLinks = await this.linkRepo.find({ where: { phone_id: phone.id } });
    const phoneLinksToUpdate = existingPhoneLinks.filter((pl) => !pl.citizen_id);
    if (phoneLinksToUpdate.length > 0) {
      for (const pl of phoneLinksToUpdate) {
        pl.citizen_id = citizen.id;
      }
      await this.linkRepo.save(phoneLinksToUpdate);
    }
    const newlyLinkedAppsCount = phoneLinksToUpdate.length;

    return {
      phone,
      wasAlreadyInDatabase: Boolean(existingBefore),
      newlyLinkedAppsCount,
    };
  }

  async removePhoneFromCitizen(phoneId: string, currentUser?: JwtAccessPayload) {
    this.assertCanMutate(currentUser);
    const phone = await this.phoneRepo.findOne({ where: { id: phoneId } });
    if (!phone) throw new NotFoundException('Telefon topilmadi');

    const linkCount = await this.linkRepo.count({ where: { phone_id: phone.id } });
    if (linkCount > 0) {
      // Arizalarda ishtirok etgan bo'lsa, master yozuvni o'chirmasdan faqat citizen_id ni uzamiz
      phone.citizen_id = null;
      phone.is_primary = false;
      await this.phoneRepo.save(phone);
      return { success: true, message: 'Telefon raqami fuqaro profilidan uzildi' };
    }

    await this.phoneRepo.remove(phone);
    return { success: true, message: 'Telefon raqami oʻchirildi' };
  }

  async addCardToCitizen(
    citizenId: string,
    dto: {
      card_number: string;
      expire_date?: string;
      bank_id?: string;
      bank_name?: string;
      full_name?: string;
    },
    currentUser?: JwtAccessPayload,
  ) {
    this.assertCanMutate(currentUser);
    const citizen = await this.citizenRepo.findOne({ where: { id: citizenId } });
    if (!citizen) throw new NotFoundException('Fuqaro topilmadi');

    const clean = (dto.card_number || '').replace(/\D/g, '');
    if (clean.length < 8) {
      throw new BadRequestException('Karta raqami notoʻgʻri kiritildi');
    }

    let bankId = dto.bank_id || null;
    if (!bankId && dto.bank_name?.trim()) {
      const bName = formatTitleCase(dto.bank_name.trim());
      let bank = await this.bankRepo.findOne({ where: { name: ILike(escapeLikePattern(bName)) } });
      if (!bank) {
        try {
          bank = await this.bankRepo.save(this.bankRepo.create({ name: bName }));
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            bank = await this.bankRepo.findOne({
              where: { name: ILike(escapeLikePattern(bName)) },
            });
            if (!bank) throw err;
          } else {
            throw err;
          }
        }
      }
      bankId = bank.id;
    }

    const existingBefore = await this.cardRepo.findOne({ where: { card_number: clean } });
    this.assertCanReassignOwnership(
      existingBefore?.citizen_id,
      citizen.id,
      'plastik karta',
      currentUser,
    );
    const defaultHolderName = dto.full_name
      ? formatUzbekName(dto.full_name)
      : this.formatCitizenFullName(citizen);

    let card = await this.syncService.upsertCard(clean, {
      citizenId: citizen.id,
      fullName: defaultHolderName,
      expireDate: dto.expire_date || null,
      bankId,
    });

    if (!card) throw new BadRequestException('Kartani saqlab boʻlmadi');

    if (card.citizen_id !== citizen.id) {
      card.citizen_id = citizen.id;
      if (bankId) card.bank_id = bankId;
      if (dto.expire_date) card.expire_date = dto.expire_date;
      card = await this.cardRepo.save(card);
    }

    const existingCardLinks = await this.linkRepo.find({ where: { card_id: card.id } });
    const cardLinksToUpdate = existingCardLinks.filter((cl) => !cl.citizen_id);
    if (cardLinksToUpdate.length > 0) {
      for (const cl of cardLinksToUpdate) {
        cl.citizen_id = citizen.id;
      }
      await this.linkRepo.save(cardLinksToUpdate);
    }
    const newlyLinkedAppsCount = cardLinksToUpdate.length;

    return {
      card,
      wasAlreadyInDatabase: Boolean(existingBefore),
      newlyLinkedAppsCount,
    };
  }

  async unlinkCardFromCitizen(cardId: string, currentUser?: JwtAccessPayload) {
    this.assertCanMutate(currentUser);
    const card = await this.cardRepo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Karta topilmadi');
    card.citizen_id = null;
    await this.cardRepo.save(card);
    return { success: true, message: 'Karta fuqaro profilidan uzildi' };
  }

  async addIdentifierToCitizen(
    citizenId: string,
    dto: { type: string; value: string; type_label?: string; notes?: string },
    currentUser?: JwtAccessPayload,
  ) {
    this.assertCanMutate(currentUser);
    const citizen = await this.citizenRepo.findOne({ where: { id: citizenId } });
    if (!citizen) throw new NotFoundException('Fuqaro topilmadi');

    const ident = await this.syncService.upsertDigitalIdentifier(dto.type, dto.value, {
      typeLabel: dto.type_label,
      citizenId: citizen.id,
      notes: dto.notes,
    });
    if (!ident) {
      throw new BadRequestException('Qiymat juda qisqa yoki notoʻgʻri');
    }

    this.assertCanReassignOwnership(ident.citizen_id, citizen.id, 'raqamli iz', currentUser);
    if (ident.citizen_id !== citizen.id) {
      ident.citizen_id = citizen.id;
      await this.identifierRepo.save(ident);
    }

    const existingLinks = await this.linkRepo.find({ where: { identifier_id: ident.id } });
    const identLinksToUpdate = existingLinks.filter((el) => !el.citizen_id);
    if (identLinksToUpdate.length > 0) {
      for (const el of identLinksToUpdate) {
        el.citizen_id = citizen.id;
      }
      await this.linkRepo.save(identLinksToUpdate);
    }
    const newlyLinkedAppsCount = identLinksToUpdate.length;

    return { identifier: ident, newlyLinkedAppsCount };
  }

  async removeIdentifierFromCitizen(identifierId: string, currentUser?: JwtAccessPayload) {
    this.assertCanMutate(currentUser);
    const ident = await this.identifierRepo.findOne({ where: { id: identifierId } });
    if (!ident) throw new NotFoundException('Identifikator topilmadi');

    const linkCount = await this.linkRepo.count({ where: { identifier_id: ident.id } });
    if (linkCount > 0) {
      ident.citizen_id = null;
      await this.identifierRepo.save(ident);
      return { success: true, message: 'Identifikator fuqaro profilidan uzildi' };
    }

    await this.identifierRepo.remove(ident);
    return { success: true, message: 'Identifikator oʻchirildi' };
  }

  /**
   * Egasi noma'lum bo'lgan Karta / Telefon / Raqamli izni tanlangan Fuqaroga biriktirish
   */
  async bindEntityToCitizen(
    dto: {
      entity_type: 'card' | 'phone' | 'identifier';
      entity_id: string;
      citizen_id: string;
    },
    currentUser?: JwtAccessPayload,
  ) {
    this.assertCanMutate(currentUser);
    const citizen = await this.citizenRepo.findOne({ where: { id: dto.citizen_id } });
    if (!citizen) throw new NotFoundException('Fuqaro topilmadi');

    if (dto.entity_type === 'card') {
      const card = await this.cardRepo.findOne({ where: { id: dto.entity_id } });
      if (!card) throw new NotFoundException('Karta topilmadi');
      this.assertCanReassignOwnership(card.citizen_id, citizen.id, 'plastik karta', currentUser);
      card.citizen_id = citizen.id;
      if (!card.full_name) card.full_name = this.formatCitizenFullName(citizen);
      await this.cardRepo.save(card);

      await this.linkRepo.update(
        { card_id: card.id, citizen_id: IsNull() },
        { citizen_id: citizen.id, source: 'CONFIRMED_MATCH' },
      );
      await this.syncService.syncApplicationsByCardId(card.id);
      return { success: true, message: 'Karta fuqaroga muvaffaqiyatli biriktirildi' };
    }

    if (dto.entity_type === 'phone') {
      const phone = await this.phoneRepo.findOne({ where: { id: dto.entity_id } });
      if (!phone) throw new NotFoundException('Telefon topilmadi');
      this.assertCanReassignOwnership(phone.citizen_id, citizen.id, 'telefon raqami', currentUser);
      phone.citizen_id = citizen.id;
      await this.phoneRepo.save(phone);

      if (!citizen.phone_number) {
        citizen.phone_number = phone.phone_number;
        await this.citizenRepo.save(citizen);
      }
      await this.linkRepo.update(
        { phone_id: phone.id, citizen_id: IsNull() },
        { citizen_id: citizen.id, source: 'CONFIRMED_MATCH' },
      );
      await this.syncService.syncApplicationsByPhoneId(phone.id);
      return { success: true, message: 'Telefon raqam fuqaroga muvaffaqiyatli biriktirildi' };
    }

    const ident = await this.identifierRepo.findOne({ where: { id: dto.entity_id } });
    if (!ident) throw new NotFoundException('Raqamli iz topilmadi');
    this.assertCanReassignOwnership(ident.citizen_id, citizen.id, 'raqamli iz', currentUser);
    ident.citizen_id = citizen.id;
    await this.identifierRepo.save(ident);

    await this.linkRepo.update(
      { identifier_id: ident.id, citizen_id: IsNull() },
      { citizen_id: citizen.id, source: 'CONFIRMED_MATCH' },
    );
    await this.syncService.syncApplicationsByIdentifierId(ident.id);
    return { success: true, message: 'Raqamli iz fuqaroga muvaffaqiyatli biriktirildi' };
  }

  /**
   * Bank vipiskasi / Karta yoki Kripto harakati bo'yicha yangi Moliyaviy Oqim O'tkazmasini kiritish
   */
  async createTransitTransfer(
    dto: {
      sender_card_id?: string;
      sender_card_number?: string;
      sender_owner_name?: string;
      sender_bank_name?: string;
      receiver_card_id?: string;
      receiver_card_number?: string;
      receiver_owner_name?: string;
      receiver_bank_name?: string;
      source_type?: string;
      source_platform?: string;
      source_network?: string;
      source_value?: string;
      source_label?: string;
      amount: number;
      currency?: string;
      transfer_date?: string;
      transfer_time?: string;
      payment_provider_id?: string;
      payment_provider_name?: string;
      transaction_id?: string;
      application_id?: string;
      destination_type?: string;
      destination_platform?: string;
      destination_network?: string;
      destination_value?: string;
      destination_label?: string;
      destination_details?: Record<string, unknown>;
    },
    currentUser?: JwtAccessPayload,
  ) {
    this.assertCanMutate(currentUser);

    const parsedAmount = Number(dto.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      throw new BadRequestException("O'tkazma summasi noto'g'ri yoki manfiy bo'lishi mumkin emas");
    }

    const resolveBankId = async (rawBankName?: string): Promise<string | null> => {
      const clean = rawBankName?.trim();
      if (!clean) return null;
      const escaped = escapeLikePattern(clean);
      let bank = await this.bankRepo.findOne({ where: { name: ILike(escaped) } });
      if (!bank) {
        try {
          bank = await this.bankRepo.save(
            this.bankRepo.create({
              name: formatTitleCase(clean),
              code: clean.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
              is_active: true,
            }),
          );
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            bank = await this.bankRepo.findOne({ where: { name: ILike(escaped) } });
            if (!bank) throw err;
          } else {
            throw err;
          }
        }
      }
      return bank.id;
    };

    const resolveIdentType = (channelType: TransferDestinationType, plat: string): string => {
      if (channelType === TransferDestinationType.CRYPTO) return 'crypto_wallet';
      if (channelType === TransferDestinationType.BANK_ACCOUNT) return 'bank_account';
      if (channelType === TransferDestinationType.PLATFORM) {
        return plat
          ? `platform_${plat.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
          : 'online_platform';
      }
      return 'cashout_destination';
    };

    const resolveTypeLabel = (
      channelType: TransferDestinationType,
      plat: string,
      net: string,
    ): string => {
      const base =
        plat ||
        (channelType === TransferDestinationType.CRYPTO
          ? 'Kripto-hamyon / Birja'
          : channelType === TransferDestinationType.BANK_ACCOUNT
            ? 'Bank hisob raqami'
            : 'Onlayn tizim / Profil');
      return net && !base.toLowerCase().includes(net.toLowerCase()) ? `${base} (${net})` : base;
    };

    const buildChannelLabel = (plat: string, net: string, val: string): string | null => {
      const prefix =
        plat && net && !plat.toLowerCase().includes(net.toLowerCase())
          ? `${plat} (${net})`
          : plat || net;
      if (prefix && val) return `${prefix}: ${val}`;
      if (val) return val;
      if (prefix) return prefix;
      return null;
    };

    const sourceType = (dto.source_type as TransferDestinationType) || TransferDestinationType.CARD;
    const destType =
      (dto.destination_type as TransferDestinationType) || TransferDestinationType.CARD;

    let senderCardId =
      sourceType === TransferDestinationType.CARD ? dto.sender_card_id || null : null;
    if (sourceType === TransferDestinationType.CARD) {
      const senderBankId = await resolveBankId(dto.sender_bank_name);
      if (!senderCardId && dto.sender_card_number) {
        const sc = await this.syncService.upsertCard(dto.sender_card_number, {
          fullName: dto.sender_owner_name ? formatUzbekName(dto.sender_owner_name) : null,
          bankId: senderBankId,
        });
        senderCardId = sc?.id || null;
      } else if (senderCardId && (dto.sender_owner_name || senderBankId)) {
        const existingCard = await this.cardRepo.findOne({ where: { id: senderCardId } });
        if (existingCard) {
          let changed = false;
          if (dto.sender_owner_name && !existingCard.full_name) {
            existingCard.full_name = formatUzbekName(dto.sender_owner_name);
            changed = true;
          }
          if (senderBankId && !existingCard.bank_id) {
            existingCard.bank_id = senderBankId;
            changed = true;
          }
          if (changed) await this.cardRepo.save(existingCard);
        }
      }
    }

    let receiverCardId =
      destType === TransferDestinationType.CARD ? dto.receiver_card_id || null : null;
    if (destType === TransferDestinationType.CARD) {
      const receiverBankId = await resolveBankId(dto.receiver_bank_name);
      if (!receiverCardId && dto.receiver_card_number) {
        const rc = await this.syncService.upsertCard(dto.receiver_card_number, {
          fullName: dto.receiver_owner_name ? formatUzbekName(dto.receiver_owner_name) : null,
          bankId: receiverBankId,
        });
        receiverCardId = rc?.id || null;
      } else if (receiverCardId && (dto.receiver_owner_name || receiverBankId)) {
        const existingCard = await this.cardRepo.findOne({ where: { id: receiverCardId } });
        if (existingCard) {
          let changed = false;
          if (dto.receiver_owner_name && !existingCard.full_name) {
            existingCard.full_name = formatUzbekName(dto.receiver_owner_name);
            changed = true;
          }
          if (receiverBankId && !existingCard.bank_id) {
            existingCard.bank_id = receiverBankId;
            changed = true;
          }
          if (changed) await this.cardRepo.save(existingCard);
        }
      }
    }

    if (senderCardId && receiverCardId && senderCardId === receiverCardId) {
      throw new BadRequestException(
        'Joʻnatuvchi va qabul qiluvchi plastik karta bir xil boʻlishi mumkin emas',
      );
    }

    // Manba (Qayerdan) — agar Karta emas (Kripto / Servis / Hisob / Naqd) bo'lsa
    let sourceIdentifierId: string | null = null;
    const sourcePlatform = dto.source_platform?.trim() || '';
    const sourceNetwork = dto.source_network?.trim() || '';
    const sourceRawVal = dto.source_value?.trim() || '';
    const sourceLabel =
      dto.source_label?.trim() || buildChannelLabel(sourcePlatform, sourceNetwork, sourceRawVal);

    if (sourceType !== TransferDestinationType.CARD) {
      senderCardId = null;
      if (sourceRawVal.length >= 2 && sourceType !== TransferDestinationType.CASH) {
        const ident = await this.syncService.upsertDigitalIdentifier(
          resolveIdentType(sourceType, sourcePlatform),
          sourceRawVal,
          {
            typeLabel: resolveTypeLabel(sourceType, sourcePlatform, sourceNetwork),
          },
        );
        sourceIdentifierId = ident?.id || null;
      }
    }

    // Qabul qiluvchi (Qayerga) — agar Karta emas (Kripto / Servis / Hisob / Naqd) bo'lsa
    let receiverIdentifierId: string | null = null;
    const platform = dto.destination_platform?.trim() || '';
    const destNetwork = dto.destination_network?.trim() || '';
    const rawVal = dto.destination_value?.trim() || '';
    let destLabel = dto.destination_label?.trim() || null;

    const destDetails: Record<string, unknown> = {
      ...(dto.destination_details || {}),
      ...(platform ? { platform } : {}),
      ...(destNetwork ? { network: destNetwork } : {}),
      ...(rawVal ? { value: rawVal } : {}),
      ...(dto.receiver_owner_name?.trim() && destType !== TransferDestinationType.CARD
        ? { owner_name: dto.receiver_owner_name.trim() }
        : {}),
      ...(sourceType !== TransferDestinationType.CARD
        ? {
            source_type: sourceType,
            ...(sourcePlatform ? { source_platform: sourcePlatform } : {}),
            ...(sourceNetwork ? { source_network: sourceNetwork } : {}),
            ...(sourceRawVal ? { source_value: sourceRawVal } : {}),
            ...(sourceLabel ? { source_label: sourceLabel } : {}),
            ...(sourceIdentifierId ? { source_identifier_id: sourceIdentifierId } : {}),
            ...(dto.sender_owner_name?.trim()
              ? { source_owner_name: dto.sender_owner_name.trim() }
              : {}),
          }
        : {}),
    };

    if (destType !== TransferDestinationType.CARD) {
      receiverCardId = null;
      if (!destLabel) {
        destLabel = buildChannelLabel(platform, destNetwork, rawVal);
      }

      if (rawVal.length >= 2 && destType !== TransferDestinationType.CASH) {
        const ident = await this.syncService.upsertDigitalIdentifier(
          resolveIdentType(destType, platform),
          rawVal,
          {
            typeLabel: resolveTypeLabel(destType, platform, destNetwork),
          },
        );
        receiverIdentifierId = ident?.id || null;
      }
    }

    const hasSource = Boolean(
      senderCardId ||
      sourceIdentifierId ||
      (sourceType !== TransferDestinationType.CARD && (sourceRawVal || sourcePlatform)),
    );
    const hasDest = Boolean(
      receiverCardId ||
      receiverIdentifierId ||
      (destType !== TransferDestinationType.CARD && (rawVal || platform)),
    );

    if (!hasSource && !hasDest) {
      throw new BadRequestException(
        'Joʻnatuvchi va qabul qiluvchi maʼlumotlari (karta, kripto-hamyon yoki kanal) koʻrsatilishi shart',
      );
    }

    let providerId = dto.payment_provider_id || null;
    if (!providerId && dto.payment_provider_name?.trim()) {
      const pName = formatTitleCase(dto.payment_provider_name.trim());
      const escapedPName = escapeLikePattern(pName);
      let prov = await this.providerRepo.findOne({ where: { name: ILike(escapedPName) } });
      if (!prov) {
        try {
          prov = await this.providerRepo.save(
            this.providerRepo.create({
              name: pName,
              code: pName.toLowerCase().replace(/\s+/g, '_'),
            }),
          );
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            prov = await this.providerRepo.findOne({ where: { name: ILike(escapedPName) } });
            if (!prov) throw err;
          } else {
            throw err;
          }
        }
      }
      providerId = prov.id;
    }

    const transfer = this.transferRepo.create({
      transaction_id: dto.transaction_id?.trim() || null,
      amount: parsedAmount,
      currency: (dto.currency || 'UZS').toUpperCase(),
      status: TransferStatus.MUVAFFAQIYATLI,
      transfer_date: dto.transfer_date || new Date().toISOString().slice(0, 10),
      transfer_time: dto.transfer_time || null,
      payment_provider_id: providerId,
      sender_card_id: senderCardId,
      receiver_card_id: receiverCardId,
      card_id: senderCardId || receiverCardId,
      application_id: dto.application_id || null,
      destination_type: destType,
      receiver_identifier_id: receiverIdentifierId,
      destination_label: destLabel,
      destination_details: Object.keys(destDetails).length > 0 ? destDetails : null,
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
    if (dto.application_id) {
      await this.syncService.syncApplicationById(dto.application_id);
    }

    return saved;
  }

  /**
   * Fuqaroni arizaga aniq rol (Gumonlanuvchi, Dropper, Guvoh, Jabrlanuvchi) bilan biriktirish
   */
  async linkCitizenRoleToApplication(
    dto: {
      application_id: string;
      citizen_id: string;
      role: EntityLinkRole;
      note?: string;
    },
    currentUser?: JwtAccessPayload,
  ) {
    this.assertCanMutate(currentUser);
    const app = await this.appRepo.findOne({
      where: { id: dto.application_id, is_deleted: false },
      select: { id: true, district_id: true },
    });
    if (!app) {
      throw new NotFoundException('Ariza topilmadi');
    }
    const permCtx = await this.getUserPermissionsContext(currentUser);
    if (!this.canEditApp(app.district_id, permCtx)) {
      throw new ForbiddenException(
        "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalariga shaxs biriktira olasiz",
      );
    }

    const existing = await this.linkRepo.findOne({
      where: {
        application_id: dto.application_id,
        citizen_id: dto.citizen_id,
        role: dto.role,
      },
    });

    if (existing) {
      existing.source = 'MANUAL_OFFICER';
      if (dto.note) existing.note = dto.note;
      return this.linkRepo.save(existing);
    }

    const link = this.linkRepo.create({
      application_id: dto.application_id,
      citizen_id: dto.citizen_id,
      role: dto.role,
      source: 'MANUAL_OFFICER',
      note: dto.note || 'Xodim tomonidan biriktirildi',
    });
    return this.linkRepo.save(link);
  }

  /**
   * Ehtimoliy moslikni 1 tugma bilan tasdiqlash
   */
  async confirmProbableMatch(
    dto: {
      citizen_id: string;
      card_id: string;
    },
    currentUser?: JwtAccessPayload,
  ) {
    return this.bindEntityToCitizen(
      {
        entity_type: 'card',
        entity_id: dto.card_id,
        citizen_id: dto.citizen_id,
      },
      currentUser,
    );
  }

  // ===========================================================================
  // 8. DOUBLE-CLICK EXPAND NODE (INTERAKTIV GRAF KENGAYTIRGICHI)
  // ===========================================================================

  async expandGraphNode(
    nodeType: string,
    entityId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<INetworkGraph> {
    const t = nodeType.toUpperCase();
    if (t === 'CITIZEN') {
      const d = await this.getCitizenDossier(entityId, currentUser);
      return d.networkGraph;
    }
    if (t === 'CARD') {
      const d = await this.getCardDossier(entityId, currentUser);
      return d.networkGraph;
    }
    if (t === 'PHONE') {
      const d = await this.getPhoneDossier(entityId, currentUser);
      return d.networkGraph;
    }
    if (t === 'IDENTIFIER') {
      const d = await this.getIdentifierDossier(entityId, currentUser);
      return d.networkGraph;
    }
    if (t === 'APPLICATION') {
      const app = await this.appRepo.findOne({
        where: { id: entityId, is_deleted: false },
        relations: { citizen: true, district: true, transfer: true },
      });
      if (!app) return { nodes: [], edges: [] };

      const permCtx = await this.getUserPermissionsContext(currentUser);
      if (
        permCtx.isDistrictOfficer &&
        (!app.district_id || !permCtx.assignedDistrictIds.includes(app.district_id))
      ) {
        return { nodes: [], edges: [] };
      }

      const links = await this.linkRepo.find({
        where: { application_id: app.id },
        relations: { card: { bank: true }, phone: true, identifier: true, citizen: true },
      });

      const nodes = new Map<string, INetworkNode>();
      const edges: INetworkEdge[] = [];
      const centerId = `application:${app.id}`;

      nodes.set(centerId, {
        id: centerId,
        entityId: app.id,
        nodeType: 'APPLICATION',
        label: `№ ${app.application_number || 'Raqamsiz'}`,
        sublabel: app.district?.name || 'Ariza',
        role: 'APPLICATION',
        riskScore: 0,
        appsCount: 1,
        amount: app.transfer?.amount ? Number(app.transfer.amount) : 0,
        targetRoute: `/applications/${app.id}`,
      });

      for (const l of links) {
        if (l.citizen) {
          const cid = `citizen:${l.citizen.id}`;
          nodes.set(cid, {
            id: cid,
            entityId: l.citizen.id,
            nodeType: 'CITIZEN',
            label: this.formatCitizenFullName(l.citizen),
            sublabel: l.role,
            role: l.role === 'VICTIM' ? 'VICTIM' : 'SUSPECT',
            riskScore: l.role === 'VICTIM' ? 15 : 75,
            appsCount: 1,
            targetRoute: `/citizens/${l.citizen.id}`,
          });
          edges.push({
            id: `exp_${centerId}_${cid}`,
            from: centerId,
            to: cid,
            relationType: l.role === 'VICTIM' ? 'VICTIM_LINK' : 'SUSPECT_CLUE',
            label: l.role,
          });
        }
        if (l.card) {
          const crdId = `card:${l.card.id}`;
          nodes.set(crdId, {
            id: crdId,
            entityId: l.card.id,
            nodeType: 'CARD',
            label: this.formatCardDisplay(l.card.card_number, l.card.masked_number),
            sublabel: l.card.bank?.name || 'Karta',
            role: l.role === 'DROPPER' || l.role === 'SUSPECT' ? 'DROPPER' : 'VICTIM',
            riskScore: l.role === 'DROPPER' ? 80 : 15,
            appsCount: 1,
            targetRoute: `/cards/${l.card.id}`,
          });
          edges.push({
            id: `exp_${centerId}_${crdId}`,
            from: centerId,
            to: crdId,
            relationType: l.role === 'DROPPER' ? 'SUSPECT_CLUE' : 'VICTIM_LINK',
            label: l.role === 'DROPPER' ? 'Dropper karta' : 'Karta',
          });
        }
        if (l.phone) {
          const pid = `phone:${l.phone.id}`;
          nodes.set(pid, {
            id: pid,
            entityId: l.phone.id,
            nodeType: 'PHONE',
            label: l.phone.formatted_number || l.phone.phone_number,
            sublabel: l.phone.operator || 'Telefon',
            role: l.role === 'SUSPECT' ? 'SUSPECT' : 'VICTIM',
            riskScore: l.role === 'SUSPECT' ? 75 : 10,
            appsCount: 1,
            targetRoute: `/dossier/phone/${l.phone.id}`,
          });
          edges.push({
            id: `exp_${centerId}_${pid}`,
            from: centerId,
            to: pid,
            relationType: l.role === 'SUSPECT' ? 'SUSPECT_CLUE' : 'VICTIM_LINK',
            label: l.role === 'SUSPECT' ? 'Gumonlanuvchi tel' : 'Telefon',
          });
        }
        if (l.identifier) {
          const iid = `identifier:${l.identifier.id}`;
          nodes.set(iid, {
            id: iid,
            entityId: l.identifier.id,
            nodeType: 'IDENTIFIER',
            label: l.identifier.raw_value,
            sublabel: l.identifier.type_label || l.identifier.type,
            role: 'SUSPECT',
            riskScore: 80,
            appsCount: 1,
            targetRoute: `/dossier/identifier/${l.identifier.id}`,
          });
          edges.push({
            id: `exp_${centerId}_${iid}`,
            from: centerId,
            to: iid,
            relationType: 'SUSPECT_CLUE',
            label: l.identifier.type_label || 'Iz',
          });
        }
      }

      return { nodes: Array.from(nodes.values()), edges };
    }

    return { nodes: [], edges: [] };
  }

  // ===========================================================================
  // 9. ANIQLANGAN JINOYATLAR (DETECTED CRIMES) BILAN FIRIBGAR KESISHMALARI
  // ===========================================================================

  async findDetectedCrimesForEntities(
    entities: {
      citizenIds: string[];
      cardNumbers: string[];
      phoneDigits: string[];
      identifierValues: string[];
    },
    currentUser?: JwtAccessPayload,
  ): Promise<DetectedCrimeLinkItem[]> {
    if (!this.detectedCrimeRepo) return [];

    const citizenIds = Array.from(new Set(entities.citizenIds.filter(Boolean)));
    const cardNumbers = Array.from(
      new Set(entities.cardNumbers.map((c) => c.replace(/\D/g, '')).filter((c) => c.length >= 8)),
    );
    const phoneDigits = Array.from(
      new Set(
        entities.phoneDigits.map((p) => normalizePhoneDigits(p)).filter((p) => p.length >= 7),
      ),
    );
    const identVals = Array.from(
      new Set(
        entities.identifierValues.map((v) => v.trim().toLowerCase()).filter((v) => v.length >= 3),
      ),
    );

    if (
      citizenIds.length === 0 &&
      cardNumbers.length === 0 &&
      phoneDigits.length === 0 &&
      identVals.length === 0
    ) {
      return [];
    }

    const matchReasonsByDcId = new Map<string, Set<string>>();
    const addReason = (dcId: string, reason: string) => {
      if (!matchReasonsByDcId.has(dcId)) {
        matchReasonsByDcId.set(dcId, new Set());
      }
      matchReasonsByDcId.get(dcId)!.add(reason);
    };

    // 1. Gumonlanuvchi fuqaro bo'yicha (detected_crime_suspects)
    if (citizenIds.length > 0 && this.detectedCrimeSuspectRepo) {
      const suspects = await this.detectedCrimeSuspectRepo.find({
        where: { citizen_id: In(citizenIds) },
        relations: { citizen: true },
      });
      for (const s of suspects) {
        addReason(
          s.detected_crime_id,
          `Gumonlanuvchi: ${this.formatCitizenFullName(s.citizen)} (${s.role_in_crime})`,
        );
      }
    }

    // 2. Ashyoviy dalillar va suspect_tree / channel_or_source_url bo'yicha
    const tokenEntries: Array<{ raw: string; pattern: string; label: string }> = [
      ...cardNumbers.map((c) => ({
        raw: c,
        pattern: `%${c.replace(/[%_\\]/g, '\\$&')}%`,
        label: `Karta: ${this.formatCardDisplay(c)}`,
      })),
      ...phoneDigits.map((p) => ({
        raw: p,
        pattern: `%${(p.length >= 9 ? p.slice(-9) : p).replace(/[%_\\]/g, '\\$&')}%`,
        label: `Telefon: ${formatPhoneDisplay(p)}`,
      })),
      ...identVals.slice(0, 20).map((v) => ({
        raw: v,
        pattern: `%${v.replace(/[%_\\]/g, '\\$&')}%`,
        label: `Raqamli iz: ${v}`,
      })),
    ];

    if (tokenEntries.length > 0) {
      const patterns = tokenEntries.map((t) => t.pattern);
      if (this.detectedCrimeEvidenceRepo) {
        const evidences: Array<{
          detected_crime_id: string;
          identifier_value: string | null;
          title: string | null;
        }> = await this.detectedCrimeRepo.manager.query(
          `SELECT e.detected_crime_id, e.identifier_value, e.title
           FROM detected_crime_evidences e
           INNER JOIN detected_crimes dc ON dc.id = e.detected_crime_id AND dc.is_deleted = false
           WHERE e.identifier_value IS NOT NULL
             AND (
               LOWER(e.identifier_value) LIKE ANY($1::text[])
               OR REGEXP_REPLACE(e.identifier_value, '[^0-9]', '', 'g') LIKE ANY($1::text[])
             )
           LIMIT 50`,
          [patterns],
        );

        for (const ev of evidences) {
          const evLow = (ev.identifier_value || '').toLowerCase();
          const evDigits = (ev.identifier_value || '').replace(/\D/g, '');
          for (const tok of tokenEntries) {
            const matchDigits = tok.raw.length >= 9 ? tok.raw.slice(-9) : tok.raw;
            if (
              evLow.includes(tok.raw) ||
              (evDigits.length >= 7 && evDigits.includes(matchDigits))
            ) {
              addReason(ev.detected_crime_id, `Ashyoviy dalil (${tok.label})`);
            }
          }
        }
      }

      const matchedDcs: Array<{
        id: string;
        channel_or_source_url: string | null;
        suspect_tree: unknown;
      }> = await this.detectedCrimeRepo.manager.query(
        `SELECT dc.id, dc.channel_or_source_url, dc.suspect_tree
         FROM detected_crimes dc
         WHERE dc.is_deleted = false
           AND (
             (dc.channel_or_source_url IS NOT NULL AND LOWER(dc.channel_or_source_url) LIKE ANY($1::text[]))
             OR (dc.suspect_tree IS NOT NULL AND LOWER(dc.suspect_tree::text) LIKE ANY($1::text[]))
           )
         LIMIT 50`,
        [patterns],
      );

      for (const row of matchedDcs) {
        const hay =
          `${row.channel_or_source_url || ''} ${JSON.stringify(row.suspect_tree || '')}`.toLowerCase();
        const hayDigits = hay.replace(/\D/g, '');
        for (const tok of tokenEntries) {
          const matchDigits = tok.raw.length >= 9 ? tok.raw.slice(-9) : tok.raw;
          if (
            hay.includes(tok.raw) ||
            (matchDigits.length >= 8 && hayDigits.includes(matchDigits))
          ) {
            addReason(row.id, tok.label);
          }
        }
      }
    }

    const dcIds = Array.from(matchReasonsByDcId.keys());
    if (dcIds.length === 0) return [];

    const permCtx = await this.getUserPermissionsContext(currentUser);
    const crimes = await this.detectedCrimeRepo.find({
      where: { id: In(dcIds), is_deleted: false },
      relations: { district: true, crime: true, crime_status: true, application_status: true },
      order: { detected_at: 'DESC' },
    });

    return crimes.map((dc) => {
      const restricted =
        permCtx.isDistrictOfficer &&
        (!dc.district_id || !permCtx.assignedDistrictIds.includes(dc.district_id));
      return {
        id: dc.id,
        case_number: restricted ? 'Boshqa tuman ishi' : dc.case_number || dc.kusp_number || null,
        title: restricted ? 'Boshqa tuman aniqlangan jinoyati' : dc.title,
        detected_at: dc.detected_at ? new Date(dc.detected_at).toISOString() : null,
        district_name: dc.district?.name || null,
        status_label:
          dc.crime_status?.name ||
          dc.application_status?.name ||
          dc.qualification_type ||
          'Tekshiruvda',
        crime_article: dc.crime?.article || dc.mjtk_article || null,
        matched_by: Array.from(matchReasonsByDcId.get(dc.id) || []),
        target_route: `/detected-crimes/${dc.id}`,
      };
    });
  }

  // ===========================================================================
  // 10. ARIZA BOG'LIQLIKLARINI BOYITISH (FIRIBGAR-MARKAZLI NETWORK + MULTI-HOP + DETECTED CRIMES)
  // ===========================================================================

  async getEnhancedApplicationIntelligence(applicationId: string, currentUser?: JwtAccessPayload) {
    const permCtx = await this.getUserPermissionsContext(currentUser);

    const currentAppMeta = await this.appRepo.findOne({
      where: { id: applicationId },
      select: { id: true, repeat_type: true, root_application_id: true },
    });
    const currentRootId = currentAppMeta?.root_application_id || applicationId;
    const isCurrentDuplicate = currentAppMeta?.repeat_type === ApplicationRepeatType.DUPLICATE;

    const currentLinksRaw = await this.linkRepo.find({
      where: { application_id: applicationId },
      relations: {
        card: { bank: true, citizen: true },
        phone: { citizen: true },
        identifier: { citizen: true },
        citizen: true,
      },
    });

    // Erkin tavsiflar (telegram_bio, other_info) avtomatik bog'liqlikka kirmaydi
    const currentLinks = currentLinksRaw.filter(
      (l) => !l.identifier || isLinkableIdentifierType(l.identifier.type),
    );

    const cardIds = Array.from(
      new Set(currentLinks.map((l) => l.card_id).filter((id): id is string => Boolean(id))),
    );
    const phoneIds = Array.from(
      new Set(currentLinks.map((l) => l.phone_id).filter((id): id is string => Boolean(id))),
    );
    const identIds = Array.from(
      new Set(currentLinks.map((l) => l.identifier_id).filter((id): id is string => Boolean(id))),
    );
    const citIds = Array.from(
      new Set(currentLinks.map((l) => l.citizen_id).filter((id): id is string => Boolean(id))),
    );

    const curCardRoleMap = new Map<string, Set<EntityLinkRole>>();
    const curPhoneRoleMap = new Map<string, Set<EntityLinkRole>>();
    const curIdentRoleMap = new Map<string, Set<EntityLinkRole>>();
    const curCitRoleMap = new Map<string, Set<EntityLinkRole>>();
    const addRole = (map: Map<string, Set<EntityLinkRole>>, k: string, r: EntityLinkRole) => {
      if (!map.has(k)) map.set(k, new Set());
      map.get(k)!.add(r);
    };
    for (const cl of currentLinks) {
      if (cl.card_id) addRole(curCardRoleMap, cl.card_id, cl.role);
      if (cl.phone_id) addRole(curPhoneRoleMap, cl.phone_id, cl.role);
      if (cl.identifier_id) addRole(curIdentRoleMap, cl.identifier_id, cl.role);
      if (cl.citizen_id) addRole(curCitRoleMap, cl.citizen_id, cl.role);
    }

    const hasFraudRoleInSet = (roles?: Set<EntityLinkRole>): boolean =>
      Boolean(roles && Array.from(roles).some((r) => isFraudLinkRole(r)));

    // Boshqa arizalardagi mosliklar (faqat firibgar/dropper/tranzit yoki rol to'qnashuvi!)
    const rawOtherLinks =
      cardIds.length || phoneIds.length || identIds.length || citIds.length
        ? await this.linkRepo.find({
            where: [
              ...(cardIds.length
                ? [{ card_id: In(cardIds), application_id: Not(applicationId) }]
                : []),
              ...(phoneIds.length
                ? [{ phone_id: In(phoneIds), application_id: Not(applicationId) }]
                : []),
              ...(identIds.length
                ? [{ identifier_id: In(identIds), application_id: Not(applicationId) }]
                : []),
              ...(citIds.length
                ? [{ citizen_id: In(citIds), application_id: Not(applicationId) }]
                : []),
            ],
            relations: {
              card: { bank: true, citizen: true },
              phone: { citizen: true },
              identifier: { citizen: true },
              citizen: true,
            },
          })
        : [];

    // Qoida: VICTIM ↔ VICTIM shovqinini chiqarib tashlash!
    const candidateOtherLinks = rawOtherLinks.filter((ol) => {
      if (ol.identifier && !isLinkableIdentifierType(ol.identifier.type)) return false;
      const otherIsFraud = isFraudLinkRole(ol.role);
      const curIsFraud =
        (ol.card_id ? hasFraudRoleInSet(curCardRoleMap.get(ol.card_id)) : false) ||
        (ol.phone_id ? hasFraudRoleInSet(curPhoneRoleMap.get(ol.phone_id)) : false) ||
        (ol.identifier_id ? hasFraudRoleInSet(curIdentRoleMap.get(ol.identifier_id)) : false) ||
        (ol.citizen_id ? hasFraudRoleInSet(curCitRoleMap.get(ol.citizen_id)) : false);
      return otherIsFraud || curIsFraud;
    });

    const otherAppIdsAll = Array.from(new Set(candidateOtherLinks.map((ol) => ol.application_id)));
    const otherAppsLoaded = await this.loadDetailedApplications(otherAppIdsAll);

    // Bir xil hodisaning DUPLICATE arizasini chiqarib tashlash
    const isSameChainDuplicate = (app: Application): boolean => {
      const otherRootId = app.root_application_id || app.id;
      const otherIsDup = app.repeat_type === ApplicationRepeatType.DUPLICATE;
      return (isCurrentDuplicate || otherIsDup) && otherRootId === currentRootId;
    };

    const otherAppMap = new Map<string, Application>();
    for (const oa of otherAppsLoaded) {
      if (!isSameChainDuplicate(oa)) {
        otherAppMap.set(oa.id, oa);
      }
    }

    const otherLinks = candidateOtherLinks.filter((ol) => otherAppMap.has(ol.application_id));

    // Multi-Hop: FAQAT firibgar/dropper/tranzit obyektlaridan boshlab 2-qadam zanjir topamiz
    // (Jabrlanuvchining o'zining 2-kartasi hech qachon multi-hop sifatida chiqmaydi!)
    const fraudLinks = currentLinks.filter((cl) => isFraudLinkRole(cl.role));
    const discoveredFraudOwnerCitizenIds = new Set<string>();
    const fraudCardIds = new Set<string>();
    const fraudPhoneDigits: string[] = [];
    const fraudCardNumbers: string[] = [];
    const fraudIdentifierValues: string[] = [];

    for (const fl of fraudLinks) {
      if (fl.citizen_id) discoveredFraudOwnerCitizenIds.add(fl.citizen_id);
      if (fl.card?.citizen_id) discoveredFraudOwnerCitizenIds.add(fl.card.citizen_id);
      if (fl.phone?.citizen_id) discoveredFraudOwnerCitizenIds.add(fl.phone.citizen_id);
      if (fl.identifier?.citizen_id) discoveredFraudOwnerCitizenIds.add(fl.identifier.citizen_id);

      if (fl.card_id) fraudCardIds.add(fl.card_id);
      if (fl.card?.card_number) fraudCardNumbers.push(fl.card.card_number);
      if (fl.phone?.phone_number) fraudPhoneDigits.push(fl.phone.phone_number);
      if (fl.identifier?.normalized_value) {
        fraudIdentifierValues.push(fl.identifier.normalized_value);
      }
    }

    const multiHopChains: MultiHopChainItem[] = [];
    const directMatchedAppIds = new Set(otherLinks.map((ol) => ol.application_id));
    directMatchedAppIds.add(applicationId);

    // Multi-Hop A: Firibgar/Dropper shaxsning BOSHQA kartalari, telefonlari va raqamli izlari
    if (discoveredFraudOwnerCitizenIds.size > 0) {
      const ownerIdsArr = Array.from(discoveredFraudOwnerCitizenIds);
      const [ownerExtraCards, ownerExtraPhones, ownerExtraIdents] = await Promise.all([
        this.cardRepo.find({
          where: { citizen_id: In(ownerIdsArr) },
          relations: { citizen: true },
        }),
        this.phoneRepo.find({
          where: { citizen_id: In(ownerIdsArr) },
          relations: { citizen: true },
        }),
        this.identifierRepo.find({
          where: { citizen_id: In(ownerIdsArr) },
          relations: { citizen: true },
        }),
      ]);

      const extraCardIds = ownerExtraCards.map((c) => c.id).filter((id) => !cardIds.includes(id));
      const extraPhoneIds = ownerExtraPhones
        .map((p) => p.id)
        .filter((id) => !phoneIds.includes(id));
      const extraIdentIds = ownerExtraIdents
        .filter((i) => isLinkableIdentifierType(i.type))
        .map((i) => i.id)
        .filter((id) => !identIds.includes(id));

      if (extraCardIds.length || extraPhoneIds.length || extraIdentIds.length) {
        const hopLinks = await this.linkRepo.find({
          where: [
            ...(extraCardIds.length ? [{ card_id: In(extraCardIds) }] : []),
            ...(extraPhoneIds.length ? [{ phone_id: In(extraPhoneIds) }] : []),
            ...(extraIdentIds.length ? [{ identifier_id: In(extraIdentIds) }] : []),
          ],
          relations: {
            card: { citizen: true },
            phone: { citizen: true },
            identifier: { citizen: true },
          },
        });

        const hopAppIds = Array.from(
          new Set(
            hopLinks.map((hl) => hl.application_id).filter((aid) => !directMatchedAppIds.has(aid)),
          ),
        );
        const hopApps = await this.loadDetailedApplications(hopAppIds);
        const hopAppMap = new Map(
          hopApps.filter((a) => !isSameChainDuplicate(a)).map((a) => [a.id, a]),
        );

        for (const hl of hopLinks) {
          const tApp = hopAppMap.get(hl.application_id);
          if (!tApp) continue;
          if (multiHopChains.some((m) => m.target_application.id === tApp.id)) continue;

          const ownerCit = hl.card?.citizen || hl.phone?.citizen || hl.identifier?.citizen;
          const viaLabel = hl.card
            ? `Karta: ${this.formatCardDisplay(hl.card.card_number, hl.card.masked_number)}`
            : hl.phone
              ? `Tel: ${hl.phone.formatted_number || hl.phone.phone_number}`
              : `${hl.identifier?.type_label || 'Raqamli iz'}: ${hl.identifier?.raw_value}`;

          const viaEntity = hl.card
            ? { type: 'card', label: viaLabel, route: `/cards/${hl.card.id}` }
            : hl.phone
              ? { type: 'phone', label: viaLabel, route: `/dossier/phone/${hl.phone.id}` }
              : {
                  type: 'identifier',
                  label: viaLabel,
                  route: `/dossier/identifier/${hl.identifier!.id}`,
                };

          multiHopChains.push({
            target_application: this.toDossierAppItem(
              tApp,
              hl.role,
              'MULTI_HOP',
              [`Firibgar/dropper egasining boshqa rekviziti (${viaLabel}) orqali zanjir`],
              permCtx,
            ),
            hops_count: 2,
            chain_steps: [
              'Joriy ariza',
              ownerCit ? this.formatCitizenFullName(ownerCit) : 'Dropper / Gumonlanuvchi',
              viaLabel,
              `Ariza № ${tApp.application_number || 'Raqamsiz'}`,
            ],
            intermediate_entities: [
              ...(ownerCit
                ? [
                    {
                      type: 'citizen',
                      label: this.formatCitizenFullName(ownerCit),
                      route: `/citizens/${ownerCit.id}`,
                    },
                  ]
                : []),
              viaEntity,
            ],
          });
        }
      }
    }

    // Multi-Hop B: Tranzit pul o'tkazmalari (Dropper Karta 1 -> Tranzit Karta 2 / Kripto -> Boshqa ariza)
    if (fraudCardIds.size > 0) {
      const fCardArr = Array.from(fraudCardIds);
      const transitTransfers = await this.transferRepo.find({
        where: [{ sender_card_id: In(fCardArr) }, { receiver_card_id: In(fCardArr) }],
        relations: {
          sender_card: true,
          receiver_card: true,
          receiver_identifier: true,
        },
        take: 100,
      });

      const transitCardIds = new Set<string>();
      const transitIdentIds = new Set<string>();
      const transitViaMap = new Map<
        string,
        { fromLabel: string; toLabel: string; toRoute: string; toType: string }
      >();

      for (const tr of transitTransfers) {
        if (tr.sender_card_id && fraudCardIds.has(tr.sender_card_id)) {
          const fromLabel = this.formatCardDisplay(
            tr.sender_card?.card_number,
            tr.sender_card?.masked_number,
          );
          if (
            tr.receiver_card_id &&
            !fraudCardIds.has(tr.receiver_card_id) &&
            !cardIds.includes(tr.receiver_card_id)
          ) {
            transitCardIds.add(tr.receiver_card_id);
            transitViaMap.set(`card:${tr.receiver_card_id}`, {
              fromLabel,
              toLabel: this.formatCardDisplay(
                tr.receiver_card?.card_number,
                tr.receiver_card?.masked_number,
              ),
              toRoute: `/cards/${tr.receiver_card_id}`,
              toType: 'card',
            });
          }
          if (
            tr.receiver_identifier_id &&
            !identIds.includes(tr.receiver_identifier_id) &&
            tr.receiver_identifier &&
            isLinkableIdentifierType(tr.receiver_identifier.type)
          ) {
            transitIdentIds.add(tr.receiver_identifier_id);
            transitViaMap.set(`ident:${tr.receiver_identifier_id}`, {
              fromLabel,
              toLabel: `${tr.receiver_identifier.type_label || tr.receiver_identifier.type}: ${tr.receiver_identifier.raw_value}`,
              toRoute: `/dossier/identifier/${tr.receiver_identifier_id}`,
              toType: 'identifier',
            });
          }
        }
      }

      if (transitCardIds.size > 0 || transitIdentIds.size > 0) {
        const transitLinks = await this.linkRepo.find({
          where: [
            ...(transitCardIds.size > 0 ? [{ card_id: In(Array.from(transitCardIds)) }] : []),
            ...(transitIdentIds.size > 0
              ? [{ identifier_id: In(Array.from(transitIdentIds)) }]
              : []),
          ],
        });
        const transitAppIds = Array.from(
          new Set(
            transitLinks
              .filter((tl) => isFraudLinkRole(tl.role))
              .map((tl) => tl.application_id)
              .filter(
                (aid) =>
                  !directMatchedAppIds.has(aid) &&
                  !multiHopChains.some((m) => m.target_application.id === aid),
              ),
          ),
        );
        if (transitAppIds.length > 0) {
          const transitApps = await this.loadDetailedApplications(transitAppIds);
          const transitAppMap = new Map(
            transitApps.filter((a) => !isSameChainDuplicate(a)).map((a) => [a.id, a]),
          );
          for (const tl of transitLinks) {
            if (!isFraudLinkRole(tl.role)) continue;
            const tApp = transitAppMap.get(tl.application_id);
            if (!tApp) continue;
            if (multiHopChains.some((m) => m.target_application.id === tApp.id)) continue;

            const viaKey = tl.card_id ? `card:${tl.card_id}` : `ident:${tl.identifier_id}`;
            const via = transitViaMap.get(viaKey);
            if (!via) continue;

            multiHopChains.push({
              target_application: this.toDossierAppItem(
                tApp,
                tl.role,
                'MULTI_HOP',
                [`Tranzit pul oqimi: ${via.fromLabel} ➔ ${via.toLabel}`],
                permCtx,
              ),
              hops_count: 2,
              chain_steps: [
                'Joriy ariza',
                via.fromLabel,
                via.toLabel,
                `Ariza № ${tApp.application_number || 'Raqamsiz'}`,
              ],
              intermediate_entities: [
                {
                  type: via.toType,
                  label: via.toLabel,
                  route: via.toRoute,
                },
              ],
            });
          }
        }
      }
    }

    // Probable matches: biriktirilmagan dropper kartaning full_name bo'yicha ehtimoliy egasi
    const probableMatches: ProbableMatchItem[] = [];
    const seenProbCardIds = new Set<string>();
    for (const fl of fraudLinks) {
      const card = fl.card;
      if (!card || card.citizen_id || !card.full_name || seenProbCardIds.has(card.id)) continue;
      seenProbCardIds.add(card.id);
      const parts = card.full_name
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      if (parts.length < 2) continue;

      const candidateCitizens = await this.citizenRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.district', 'district')
        .where('c.full_name ILIKE :p0 AND c.full_name ILIKE :p1', {
          p0: `%${parts[0]}%`,
          p1: `%${parts[1]}%`,
        })
        .take(5)
        .getMany();

      for (const cand of candidateCitizens) {
        probableMatches.push({
          id: `prob_app_card_${card.id}_${cand.id}`,
          match_type: 'CARD_OWNER_NAME',
          confidence: 88,
          title: `${this.formatCardDisplay(card.card_number, card.masked_number)} ↔ ${this.formatCitizenFullName(cand)}`,
          subtitle: `Kartadagi F.I.Sh.: "${card.full_name}" · ${cand.passport ? `Pasport: ${cand.passport}` : cand.phone_number ? formatPhoneDisplay(cand.phone_number) : cand.district?.name || 'Fuqaro'}`,
          reason: `Dropper kartadagi "${card.full_name}" yozuvi bazadagi fuqaro profiliga mos keldi (hali rasman biriktirilmagan).`,
          target_entity_type: 'citizen',
          target_entity_id: cand.id,
          target_route: `/citizens/${cand.id}`,
          linked_apps_count: 0,
          total_amount: 0,
          confirm_action: {
            action_type: 'LINK_CITIZEN_TO_CARD',
            citizen_id: cand.id,
            card_id: card.id,
          },
        });
      }
    }

    // Aniqlangan jinoyatlar bilan kesishma
    const detectedCrimeRelations = await this.findDetectedCrimesForEntities(
      {
        citizenIds: Array.from(discoveredFraudOwnerCitizenIds),
        cardNumbers: fraudCardNumbers,
        phoneDigits: fraudPhoneDigits,
        identifierValues: fraudIdentifierValues,
      },
      currentUser,
    );

    // Network Graph for Application (faqat firibgar / rol-to'qnashuvi kesishmalarini ulaymiz)
    const baseExpand = await this.expandGraphNode('APPLICATION', applicationId, currentUser);
    const nodes = new Map<string, INetworkNode>(baseExpand.nodes.map((n) => [n.id, n]));
    const edges: INetworkEdge[] = [...baseExpand.edges];

    const centerNode = nodes.get(`application:${applicationId}`);
    if (centerNode) centerNode.isCenter = true;

    for (const ol of otherLinks) {
      const oa = otherAppMap.get(ol.application_id);
      if (!oa) continue;
      const restricted =
        permCtx.isDistrictOfficer &&
        (!oa.district_id || !permCtx.assignedDistrictIds.includes(oa.district_id));
      const oaNodeId = `application:${oa.id}`;
      if (!nodes.has(oaNodeId)) {
        nodes.set(oaNodeId, {
          id: oaNodeId,
          entityId: oa.id,
          nodeType: 'APPLICATION',
          label: restricted ? 'Boshqa tuman' : `№ ${oa.application_number || 'Raqamsiz'}`,
          sublabel: restricted ? 'Boshqa tuman arizasi' : oa.district?.name || oa.status || 'Ariza',
          role: 'APPLICATION',
          riskScore: 0,
          appsCount: 1,
          amount: oa.transfer?.amount ? Number(oa.transfer.amount) : 0,
          targetRoute: `/applications/${oa.id}`,
        });
      }

      const bridgeId = ol.card_id
        ? `card:${ol.card_id}`
        : ol.phone_id
          ? `phone:${ol.phone_id}`
          : ol.identifier_id
            ? `identifier:${ol.identifier_id}`
            : ol.citizen_id
              ? `citizen:${ol.citizen_id}`
              : null;

      if (bridgeId && nodes.has(bridgeId)) {
        const edgeId = `rel_${bridgeId}_${oaNodeId}`;
        if (!edges.some((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            from: bridgeId,
            to: oaNodeId,
            relationType:
              ol.role === 'SUSPECT' || ol.role === 'DROPPER' || ol.role === 'TRANSIT'
                ? 'SUSPECT_CLUE'
                : 'VICTIM_LINK',
            label:
              ol.role === 'DROPPER'
                ? 'Dropper'
                : ol.role === 'SUSPECT'
                  ? 'Gumonlanuvchi'
                  : ol.role === 'TRANSIT'
                    ? 'Tranzit'
                    : 'Rol toʻqnashuvi',
          });
        }
      }
    }

    // Telefon va Raqamli izlar ro'yxati — FAQAT gumonlanuvchi/dropper/tranzit yoki rol to'qnashuvi!
    // (Jabrlanuvchining oddiy telefoni boshqa jabrlanuvchi sifatida chiqarilmaydi!)
    const seenClueKeys = new Set<string>();
    const clueRelations = [
      ...currentLinks
        .filter((l) => {
          if (!l.phone) return false;
          const matchingOther = otherLinks.filter((ol) => ol.phone_id === l.phone_id);
          return isFraudLinkRole(l.role) || matchingOther.some((ol) => isFraudLinkRole(ol.role));
        })
        .map((l) => {
          const dedupKey = `phone:${l.phone!.id}`;
          if (seenClueKeys.has(dedupKey)) return null;
          seenClueKeys.add(dedupKey);
          const matchingOther = otherLinks.filter((ol) => ol.phone_id === l.phone_id);
          const seenOtherAppIds = new Set<string>();
          return {
            id: l.phone!.id,
            entity_type: 'phone' as const,
            label: l.role === 'VICTIM' ? 'Telefon (Rol toʻqnashuvi)' : 'Gumonlanuvchi telefoni',
            value: l.phone!.formatted_number || formatPhoneDisplay(l.phone!.phone_number),
            operator: l.phone!.operator,
            role_in_current_app: l.role,
            owner_citizen: l.phone!.citizen
              ? {
                  id: l.phone!.citizen.id,
                  full_name: this.formatCitizenFullName(l.phone!.citizen),
                }
              : null,
            target_route: `/dossier/phone/${l.phone!.id}`,
            linked_applications: matchingOther
              .map((mo) => {
                if (seenOtherAppIds.has(mo.application_id)) return null;
                seenOtherAppIds.add(mo.application_id);
                const oa = otherAppMap.get(mo.application_id);
                if (!oa) return null;
                const isCrossRole = isFraudLinkRole(l.role) !== isFraudLinkRole(mo.role);
                return this.toDossierAppItem(
                  oa,
                  mo.role,
                  mo.source,
                  [isCrossRole ? 'Rol toʻqnashuvi (Telefon)' : 'Bir xil gumonlanuvchi telefoni'],
                  permCtx,
                );
              })
              .filter((x): x is DossierApplicationItem => Boolean(x)),
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
      ...currentLinks
        .filter((l) => l.identifier && isLinkableIdentifierType(l.identifier.type))
        .map((l) => {
          const dedupKey = `ident:${l.identifier!.id}`;
          if (seenClueKeys.has(dedupKey)) return null;
          seenClueKeys.add(dedupKey);
          const matchingOther = otherLinks.filter((ol) => ol.identifier_id === l.identifier_id);
          const seenOtherAppIds = new Set<string>();
          return {
            id: l.identifier!.id,
            entity_type: 'identifier' as const,
            label: l.identifier!.type_label || getIdentifierTypeLabel(l.identifier!.type),
            value: l.identifier!.raw_value,
            operator: null,
            role_in_current_app: l.role,
            owner_citizen: l.identifier!.citizen
              ? {
                  id: l.identifier!.citizen.id,
                  full_name: this.formatCitizenFullName(l.identifier!.citizen),
                }
              : null,
            target_route: `/dossier/identifier/${l.identifier!.id}`,
            linked_applications: matchingOther
              .map((mo) => {
                if (seenOtherAppIds.has(mo.application_id)) return null;
                seenOtherAppIds.add(mo.application_id);
                const oa = otherAppMap.get(mo.application_id);
                return oa
                  ? this.toDossierAppItem(
                      oa,
                      mo.role,
                      mo.source,
                      [`Bir xil ${l.identifier!.type_label || 'belgi'}`],
                      permCtx,
                    )
                  : null;
              })
              .filter((x): x is DossierApplicationItem => Boolean(x)),
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    ];

    return {
      clue_relations: clueRelations,
      multi_hop_chains: multiHopChains,
      probable_matches: probableMatches,
      detected_crime_relations: detectedCrimeRelations,
      network_graph: {
        nodes: Array.from(nodes.values()),
        edges,
      },
    };
  }
}
