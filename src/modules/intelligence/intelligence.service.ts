import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, IsNull, Not, Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
import { TransferStatus } from '../../common/enums/transfer-status.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { formatTitleCase, formatUzbekName } from '../../common/utils/name-formatter.util';
import { Application } from '../applications/application.entity';
import { Citizen } from '../applications/citizens/citizen.entity';
import { Bank } from '../applications/transfers/banks/bank.entity';
import { Card } from '../applications/transfers/cards/card.entity';
import { PaymentProvider } from '../applications/transfers/payment_providers/payment_provider.entity';
import { Transfer } from '../applications/transfers/transfer.entity';
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
  normalizeIdentifierValue,
  normalizePhoneDigits,
} from './utils/identifier-normalizer.util';

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
    if (!appDistrictId) return true;
    return ctx.assignedDistrictIds.includes(appDistrictId);
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
    return (
      [cit.last_name, cit.first_name, cit.middle_name].filter(Boolean).join(' ').trim() ||
      'Ism kiritilmagan'
    );
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

    const digits = q.replace(/\D/g, '');
    const handleClean = q
      .replace(/^https?:\/\/(t\.me|telegram\.me|instagram\.com)\//i, '')
      .replace(/^@+/, '')
      .trim();
    const ilikeQ = `%${q}%`;
    const perCategoryLimit = Math.min(Math.max(Number(limit) || 25, 10), 50);

    // 1. Fuqarolar qidiruvi
    const citizenQb = this.citizenRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.district', 'district')
      .leftJoinAndSelect('c.cards', 'cards')
      .where(
        `(
          c.first_name ILIKE :ilikeQ
          OR c.last_name ILIKE :ilikeQ
          OR c.middle_name ILIKE :ilikeQ
          OR CONCAT(COALESCE(c.last_name,''), ' ', COALESCE(c.first_name,''), ' ', COALESCE(c.middle_name,'')) ILIKE :ilikeQ
          OR c.passport ILIKE :ilikeQ
          OR c.pinfl ILIKE :ilikeQ
          OR c.address ILIKE :ilikeQ
          ${digits.length >= 3 ? 'OR c.phone_number ILIKE :digitsQ OR c.pinfl ILIKE :digitsQ' : ''}
        )`,
        { ilikeQ, digitsQ: `%${digits}%` },
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
        { ilikeQ, digitsQ: `%${digits}%` },
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
        { ilikeQ, digitsQ: `%${digits}%` },
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
        { ilikeQ, handleQ: `%${handleClean.toLowerCase()}%` },
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
        { ilikeQ, digitsQ: `%${digits}%` },
      )
      .orderBy('tr.created_at', 'DESC')
      .take(15);

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

    const _unusedUser = currentUser;
    void _unusedUser;

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
    let entityType: 'card' | 'phone' | 'identifier' | 'citizen' | undefined;
    let entityId: string | undefined;
    let title: string | undefined;
    let subtitle: string | undefined;
    let targetRoute: string | undefined;
    let ownerCitizen: LiveRadarResponse['ownerCitizen'] = null;
    let links: EntityApplicationLink[] = [];

    if (cleanType.includes('card') || cleanType.includes('karta')) {
      const digits = rawValue.replace(/\D/g, '');
      if (digits.length < 8) return empty;
      const card = await this.cardRepo.findOne({
        where: { card_number: digits },
        relations: { citizen: true, bank: true },
      });
      if (!card) return empty;

      entityType = 'card';
      entityId = card.id;
      title = this.formatCardDisplay(card.card_number, card.masked_number);
      subtitle = card.bank?.name || this.financialFlowService.identifyBank(digits);
      targetRoute = `/cards/${card.id}`;
      if (card.citizen) {
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
    } else if (cleanType.includes('phone') || cleanType.includes('telefon')) {
      const digits = normalizePhoneDigits(rawValue);
      if (digits.length < 7) return empty;
      const phone = await this.phoneRepo.findOne({
        where: { phone_number: digits },
        relations: { citizen: true },
      });
      if (!phone) return empty;

      entityType = 'phone';
      entityId = phone.id;
      title = phone.formatted_number || formatPhoneDisplay(phone.phone_number);
      subtitle = phone.operator || 'Aloqa tarmogʻi';
      targetRoute = `/dossier/phone/${phone.id}`;
      if (phone.citizen) {
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
    } else if (cleanType === 'pinfl' || cleanType === 'passport') {
      const cleanVal =
        cleanType === 'pinfl'
          ? rawValue.replace(/\D/g, '')
          : rawValue.replace(/\s+/g, '').toUpperCase();
      if (cleanVal.length < 6) return empty;

      const citizen = await this.citizenRepo.findOne({
        where: cleanType === 'pinfl' ? { pinfl: cleanVal } : { passport: cleanVal },
      });
      if (!citizen) return empty;

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
    } else {
      const normalized = normalizeIdentifierValue(cleanType, rawValue);
      if (normalized.length < 3) return empty;

      const ident = await this.identifierRepo.findOne({
        where: [
          { type: cleanType, normalized_value: normalized },
          { normalized_value: normalized },
        ],
        relations: { citizen: true },
      });
      if (!ident) return empty;

      entityType = 'identifier';
      entityId = ident.id;
      title = ident.raw_value;
      subtitle = ident.type_label || getIdentifierTypeLabel(ident.type);
      targetRoute = `/dossier/identifier/${ident.id}`;
      if (ident.citizen) {
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

    const filteredLinks = links.filter(
      (l) => l.application && !l.application.is_deleted && l.application_id !== excludeAppId,
    );

    if (filteredLinks.length === 0 && !ownerCitizen) {
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
        totalLoss: 0,
        riskLevel: 'LOW',
        recentApplications: [],
      };
    }

    const byApp = new Map<
      string,
      {
        id: string;
        application_number: string;
        role: string;
        date: string | null;
        amount: number | null;
      }
    >();

    let suspectCount = 0;
    let victimCount = 0;
    let totalLoss = 0;

    for (const l of filteredLinks) {
      const app = l.application;
      const amt = app.transfer?.amount ? Number(app.transfer.amount) : null;
      if (!byApp.has(app.id)) {
        byApp.set(app.id, {
          id: app.id,
          application_number: app.application_number || 'Raqamsiz',
          role: l.role,
          date: app.date ? new Date(app.date).toISOString() : app.created_at.toISOString(),
          amount: amt,
        });
        totalLoss += amt || 0;
        if (l.role === 'SUSPECT' || l.role === 'DROPPER') suspectCount++;
        else if (l.role === 'VICTIM') victimCount++;
      }
    }

    const riskLevel: LiveRadarResponse['riskLevel'] =
      suspectCount >= 2
        ? 'CRITICAL'
        : suspectCount === 1
          ? 'HIGH'
          : victimCount > 0
            ? 'MEDIUM'
            : 'LOW';

    return {
      found: true,
      entityType,
      entityId,
      title,
      subtitle,
      targetRoute,
      ownerCitizen,
      appsCount: byApp.size,
      suspectCount,
      victimCount,
      totalLoss,
      riskLevel,
      recentApplications: Array.from(byApp.values()).slice(0, 5),
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

    for (const a of directApps) {
      if (a.role_in_app === 'VICTIM') victimAppsCount++;
      else if (a.role_in_app === 'SUSPECT' || a.role_in_app === 'DROPPER')
        suspectOrDropperAppsCount++;
      else if (a.role_in_app === 'WITNESS') witnessAppsCount++;

      const amt = Number(a.transfer_amount || 0);
      totalLossInLinkedApps += amt;

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
        d.loss += amt;
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

      if (a.payment_provider) {
        const p = providerMap.get(a.payment_provider) || {
          name: a.payment_provider,
          count: 0,
          amount: 0,
        };
        p.count++;
        p.amount += amt;
        providerMap.set(a.payment_provider, p);
      }
    }

    let totalIncomingAmount = 0;
    let totalOutgoingAmount = 0;
    let maxTransactionAmount = 0;

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
      if (tr.direction === 'INCOMING') totalIncomingAmount += amt;
      else if (tr.direction === 'OUTGOING') totalOutgoingAmount += amt;
      else {
        totalIncomingAmount += amt;
        totalOutgoingAmount += amt;
      }

      if (amt > maxTransactionAmount) maxTransactionAmount = amt;

      if (tr.transfer_date) {
        const ts = new Date(tr.transfer_date).getTime();
        if (!isNaN(ts)) allDates.push(ts);
      }

      if (tr.payment_provider && !providerMap.has(tr.payment_provider)) {
        providerMap.set(tr.payment_provider, {
          name: tr.payment_provider,
          count: 1,
          amount: amt,
        });
      }

      let hour: number | null = null;
      if (tr.transfer_time) {
        const m = tr.transfer_time.match(/^(\d{1,2}):/);
        if (m) hour = parseInt(m[1], 10);
      }
      if (hour !== null && hour >= 0 && hour < 24) {
        const idx = Math.min(Math.floor(hour / 4), 5);
        hourlySlots[idx].count++;
        hourlySlots[idx].amount += amt;
      }
    }

    const totalVolume = totalIncomingAmount + totalOutgoingAmount;
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
    return {
      id: app.id,
      application_number: app.application_number || 'Raqamsiz',
      description: app.description || null,
      officer_notes: app.officer_notes || null,
      status: app.status,
      status_label: app.application_status?.name || app.status || 'YANGI',
      status_color: app.application_status?.color || '#3b82f6',
      date: app.date ? new Date(app.date).toISOString() : app.created_at.toISOString(),
      district_id: app.district_id,
      district_name: app.district?.name || null,
      crime_article: app.crime?.article || null,
      crime_method: app.crime_method?.name || null,
      victim_name: app.citizen ? this.formatCitizenFullName(app.citizen) : null,
      victim_phone: app.citizen?.phone_number || null,
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
  ): DossierTransferItem[] {
    return rawTransfers.map((tr) => {
      const sOwned = tr.sender_card_id ? ownedCardIds.has(tr.sender_card_id) : false;
      const rOwned = tr.receiver_card_id ? ownedCardIds.has(tr.receiver_card_id) : false;
      const direction: DossierTransferItem['direction'] =
        sOwned && rOwned ? 'INTERNAL' : rOwned ? 'INCOMING' : 'OUTGOING';

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
        mahalla: true,
        occupation_category: true,
        occupation: true,
        workplace: {
          district: true,
          mahalla: true,
          occupation_category: true,
        },
      },
    });

    if (!citizen) {
      throw new NotFoundException(`Fuqaro (ID: ${citizenId}) topilmadi`);
    }

    await this.syncService.syncCitizenEntity(citizen);
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
    if (citizen.first_name && citizen.last_name) {
      const fNorm = this.normalizePersonName(citizen.first_name);
      const lNorm = this.normalizePersonName(citizen.last_name);

      if (fNorm.length >= 2 && lNorm.length >= 2) {
        const unlinkedCards = await this.cardRepo.find({
          where: [
            { citizen_id: IsNull(), full_name: ILike(`%${citizen.last_name.trim()}%`) },
            { citizen_id: IsNull(), full_name: ILike(`%${citizen.first_name.trim()}%`) },
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
        citizen: { district: true, mahalla: true },
      },
    });

    if (!card) {
      throw new NotFoundException(`Karta (ID: ${cardId}) topilmadi`);
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);

    const directLinks = await this.linkRepo.find({
      where: { card_id: card.id },
    });

    const appRoleMap = new Map<string, { role: EntityLinkRole; source: string; note?: string }>();
    for (const l of directLinks) {
      appRoleMap.set(l.application_id, {
        role: l.role,
        source: l.source,
        note: l.note || undefined,
      });
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
        const candidateCitizens = await this.citizenRepo.find({
          where: [
            { last_name: ILike(`%${parts[0]}%`), first_name: ILike(`%${parts[1]}%`) },
            { first_name: ILike(`%${parts[0]}%`), last_name: ILike(`%${parts[1]}%`) },
          ],
          relations: { district: true },
          take: 10,
        });

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
      relations: { citizen: { district: true, mahalla: true } },
    });
    if (!phone) {
      throw new NotFoundException(`Telefon raqam (ID: ${phoneId}) topilmadi`);
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);
    const links = await this.linkRepo.find({ where: { phone_id: phone.id } });

    const appRoleMap = new Map<string, { role: EntityLinkRole; source: string; note?: string }>();
    for (const l of links) {
      appRoleMap.set(l.application_id, {
        role: l.role,
        source: l.source,
        note: l.note || undefined,
      });
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
    const transfers = this.mapTransfersForCardSet(rawTransfers, cardSet);
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
      relations: { citizen: { district: true, mahalla: true } },
    });
    if (!identifier) {
      throw new NotFoundException(`Raqamli identifikator (ID: ${identifierId}) topilmadi`);
    }

    const permCtx = await this.getUserPermissionsContext(currentUser);
    const links = await this.linkRepo.find({ where: { identifier_id: identifier.id } });

    const appRoleMap = new Map<string, { role: EntityLinkRole; source: string; note?: string }>();
    for (const l of links) {
      appRoleMap.set(l.application_id, {
        role: l.role,
        source: l.source,
        note: l.note || undefined,
      });
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

    const rawTransfers = directAppEntities
      .map((a) => a.transfer)
      .filter((t): t is Transfer => Boolean(t));
    const transfers = this.mapTransfersForCardSet(rawTransfers, new Set());
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
    let newlyLinkedAppsCount = 0;
    for (const pl of existingPhoneLinks) {
      if (!pl.citizen_id) {
        pl.citizen_id = citizen.id;
        await this.linkRepo.save(pl);
        newlyLinkedAppsCount++;
      }
    }

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
      let bank = await this.bankRepo.findOne({ where: { name: ILike(bName) } });
      if (!bank) {
        bank = await this.bankRepo.save(this.bankRepo.create({ name: bName }));
      }
      bankId = bank.id;
    }

    const existingBefore = await this.cardRepo.findOne({ where: { card_number: clean } });
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
    let newlyLinkedAppsCount = 0;
    for (const cl of existingCardLinks) {
      if (!cl.citizen_id) {
        cl.citizen_id = citizen.id;
        await this.linkRepo.save(cl);
        newlyLinkedAppsCount++;
      }
    }

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

    if (ident.citizen_id !== citizen.id) {
      ident.citizen_id = citizen.id;
      await this.identifierRepo.save(ident);
    }

    const existingLinks = await this.linkRepo.find({ where: { identifier_id: ident.id } });
    let newlyLinkedAppsCount = 0;
    for (const el of existingLinks) {
      if (!el.citizen_id) {
        el.citizen_id = citizen.id;
        await this.linkRepo.save(el);
        newlyLinkedAppsCount++;
      }
    }

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
      card.citizen_id = citizen.id;
      if (!card.full_name) card.full_name = this.formatCitizenFullName(citizen);
      await this.cardRepo.save(card);

      await this.linkRepo.update(
        { card_id: card.id, citizen_id: IsNull() },
        { citizen_id: citizen.id, source: 'CONFIRMED_MATCH' },
      );
      return { success: true, message: 'Karta fuqaroga muvaffaqiyatli biriktirildi' };
    }

    if (dto.entity_type === 'phone') {
      const phone = await this.phoneRepo.findOne({ where: { id: dto.entity_id } });
      if (!phone) throw new NotFoundException('Telefon topilmadi');
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
      return { success: true, message: 'Telefon raqam fuqaroga muvaffaqiyatli biriktirildi' };
    }

    const ident = await this.identifierRepo.findOne({ where: { id: dto.entity_id } });
    if (!ident) throw new NotFoundException('Raqamli iz topilmadi');
    ident.citizen_id = citizen.id;
    await this.identifierRepo.save(ident);

    await this.linkRepo.update(
      { identifier_id: ident.id, citizen_id: IsNull() },
      { citizen_id: citizen.id, source: 'CONFIRMED_MATCH' },
    );
    return { success: true, message: 'Raqamli iz fuqaroga muvaffaqiyatli biriktirildi' };
  }

  /**
   * Bank vipiskasi / Karta harakati bo'yicha yangi Tranzit O'tkazmani to'g'ridan-to'g'ri Dosyedan kiritish
   */
  async createTransitTransfer(
    dto: {
      sender_card_id?: string;
      sender_card_number?: string;
      sender_owner_name?: string;
      receiver_card_id?: string;
      receiver_card_number?: string;
      receiver_owner_name?: string;
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
      destination_value?: string;
      destination_label?: string;
      destination_details?: Record<string, unknown>;
    },
    currentUser?: JwtAccessPayload,
  ) {
    this.assertCanMutate(currentUser);

    const destType =
      (dto.destination_type as TransferDestinationType) || TransferDestinationType.CARD;

    let senderCardId = dto.sender_card_id || null;
    if (!senderCardId && dto.sender_card_number) {
      const sc = await this.syncService.upsertCard(dto.sender_card_number, {
        fullName: dto.sender_owner_name ? formatUzbekName(dto.sender_owner_name) : null,
      });
      senderCardId = sc?.id || null;
    }

    let receiverCardId = dto.receiver_card_id || null;
    if (destType === TransferDestinationType.CARD && !receiverCardId && dto.receiver_card_number) {
      const rc = await this.syncService.upsertCard(dto.receiver_card_number, {
        fullName: dto.receiver_owner_name ? formatUzbekName(dto.receiver_owner_name) : null,
      });
      receiverCardId = rc?.id || null;
    }

    let receiverIdentifierId: string | null = null;
    const platform = dto.destination_platform?.trim() || '';
    const rawVal = dto.destination_value?.trim() || '';
    let destLabel = dto.destination_label?.trim() || null;
    const destDetails: Record<string, unknown> = {
      ...(dto.destination_details || {}),
      ...(platform ? { platform } : {}),
      ...(rawVal ? { value: rawVal } : {}),
    };

    if (destType !== TransferDestinationType.CARD) {
      receiverCardId = null;
      if (!destLabel) {
        if (platform && rawVal) destLabel = `${platform}: ${rawVal}`;
        else if (rawVal) destLabel = rawVal;
        else if (platform) destLabel = platform;
      }

      if (rawVal.length >= 2 && destType !== TransferDestinationType.CASH) {
        const identType =
          destType === TransferDestinationType.CRYPTO
            ? 'crypto_wallet'
            : destType === TransferDestinationType.BANK_ACCOUNT
              ? 'bank_account'
              : destType === TransferDestinationType.PLATFORM
                ? platform
                  ? `platform_${platform.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
                  : 'online_platform'
                : 'cashout_destination';

        const ident = await this.syncService.upsertDigitalIdentifier(identType, rawVal, {
          typeLabel:
            platform ||
            (destType === TransferDestinationType.CRYPTO
              ? 'Kripto-hamyon / Birja'
              : destType === TransferDestinationType.BANK_ACCOUNT
                ? 'Bank hisob raqami'
                : 'Onlayn tizim / Profil'),
        });
        receiverIdentifierId = ident?.id || null;
      }
    }

    if (!senderCardId && !receiverCardId) {
      throw new BadRequestException(
        'Kamida bitta plastik karta (joʻnatuvchi yoki qabul qiluvchi) koʻrsatilishi shart',
      );
    }

    let providerId = dto.payment_provider_id || null;
    if (!providerId && dto.payment_provider_name?.trim()) {
      const pName = formatTitleCase(dto.payment_provider_name.trim());
      let prov = await this.providerRepo.findOne({ where: { name: ILike(pName) } });
      if (!prov) {
        prov = await this.providerRepo.save(
          this.providerRepo.create({
            name: pName,
            code: pName.toLowerCase().replace(/\s+/g, '_'),
          }),
        );
      }
      providerId = prov.id;
    }

    const transfer = this.transferRepo.create({
      transaction_id: dto.transaction_id?.trim() || null,
      amount: Number(dto.amount) || 0,
      currency: dto.currency || 'UZS',
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

    const saved = await this.transferRepo.save(transfer);
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

  async expandGraphNode(nodeType: string, entityId: string): Promise<INetworkGraph> {
    const t = nodeType.toUpperCase();
    if (t === 'CITIZEN') {
      const d = await this.getCitizenDossier(entityId);
      return d.networkGraph;
    }
    if (t === 'CARD') {
      const d = await this.getCardDossier(entityId);
      return d.networkGraph;
    }
    if (t === 'PHONE') {
      const d = await this.getPhoneDossier(entityId);
      return d.networkGraph;
    }
    if (t === 'IDENTIFIER') {
      const d = await this.getIdentifierDossier(entityId);
      return d.networkGraph;
    }
    if (t === 'APPLICATION') {
      const app = await this.appRepo.findOne({
        where: { id: entityId },
        relations: { citizen: true, district: true, transfer: true },
      });
      if (!app) return { nodes: [], edges: [] };

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
  // 9. ARIZA BOG'LIQLIKLARINI BOYITISH (NETWORK GRAPH + CROSS-ROLE + MULTI-HOP)
  // ===========================================================================

  async getEnhancedApplicationIntelligence(applicationId: string, currentUser?: JwtAccessPayload) {
    await this.syncService.syncApplicationById(applicationId);
    const permCtx = await this.getUserPermissionsContext(currentUser);

    const currentLinks = await this.linkRepo.find({
      where: { application_id: applicationId },
      relations: {
        card: { bank: true, citizen: true },
        phone: { citizen: true },
        identifier: { citizen: true },
        citizen: true,
      },
    });

    const cardIds = currentLinks.map((l) => l.card_id).filter((id): id is string => Boolean(id));
    const phoneIds = currentLinks.map((l) => l.phone_id).filter((id): id is string => Boolean(id));
    const identIds = currentLinks
      .map((l) => l.identifier_id)
      .filter((id): id is string => Boolean(id));
    const citIds = currentLinks.map((l) => l.citizen_id).filter((id): id is string => Boolean(id));

    // Cross-role va boshqa arizalardagi mosliklar
    const otherLinks =
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

    // Multi-hop: Ushbu arizadagi karta/telefon egalarining (citizen_id) BOSHQA kartalari yoki telefonlari qatnashgan arizalar!
    const discoveredOwnerCitizenIds = new Set<string>(citIds);
    for (const cl of currentLinks) {
      if (cl.card?.citizen_id) discoveredOwnerCitizenIds.add(cl.card.citizen_id);
      if (cl.phone?.citizen_id) discoveredOwnerCitizenIds.add(cl.phone.citizen_id);
      if (cl.identifier?.citizen_id) discoveredOwnerCitizenIds.add(cl.identifier.citizen_id);
    }

    const multiHopChains: MultiHopChainItem[] = [];
    const directMatchedAppIds = new Set(otherLinks.map((ol) => ol.application_id));
    directMatchedAppIds.add(applicationId);

    if (discoveredOwnerCitizenIds.size > 0) {
      const ownerIdsArr = Array.from(discoveredOwnerCitizenIds);
      const [ownerExtraCards, ownerExtraPhones] = await Promise.all([
        this.cardRepo.find({
          where: { citizen_id: In(ownerIdsArr) },
          relations: { citizen: true },
        }),
        this.phoneRepo.find({
          where: { citizen_id: In(ownerIdsArr) },
          relations: { citizen: true },
        }),
      ]);

      const extraCardIds = ownerExtraCards.map((c) => c.id).filter((id) => !cardIds.includes(id));
      const extraPhoneIds = ownerExtraPhones
        .map((p) => p.id)
        .filter((id) => !phoneIds.includes(id));

      if (extraCardIds.length || extraPhoneIds.length) {
        const hopLinks = await this.linkRepo.find({
          where: [
            ...(extraCardIds.length ? [{ card_id: In(extraCardIds) }] : []),
            ...(extraPhoneIds.length ? [{ phone_id: In(extraPhoneIds) }] : []),
          ],
          relations: { card: { citizen: true }, phone: { citizen: true } },
        });

        const hopAppIds = Array.from(
          new Set(
            hopLinks.map((hl) => hl.application_id).filter((aid) => !directMatchedAppIds.has(aid)),
          ),
        );
        const hopApps = await this.loadDetailedApplications(hopAppIds);
        const hopAppMap = new Map(hopApps.map((a) => [a.id, a]));

        for (const hl of hopLinks) {
          const tApp = hopAppMap.get(hl.application_id);
          if (!tApp) continue;
          if (multiHopChains.some((m) => m.target_application.id === tApp.id)) continue;

          const ownerCit = hl.card?.citizen || hl.phone?.citizen;
          const viaLabel = hl.card
            ? `Karta: ${this.formatCardDisplay(hl.card.card_number, hl.card.masked_number)}`
            : `Tel: ${hl.phone?.formatted_number || hl.phone?.phone_number}`;

          multiHopChains.push({
            target_application: this.toDossierAppItem(
              tApp,
              hl.role,
              'MULTI_HOP',
              [`Shaxsning boshqa rekviziti (${viaLabel}) orqali zanjir`],
              permCtx,
            ),
            hops_count: 2,
            chain_steps: [
              'Joriy ariza',
              ownerCit ? this.formatCitizenFullName(ownerCit) : 'Umumiy shaxs',
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
              {
                type: hl.card ? 'card' : 'phone',
                label: viaLabel,
                route: hl.card ? `/cards/${hl.card.id}` : `/dossier/phone/${hl.phone!.id}`,
              },
            ],
          });
        }
      }
    }

    // Network Graph for Application
    const baseExpand = await this.expandGraphNode('APPLICATION', applicationId);
    const nodes = new Map<string, INetworkNode>(baseExpand.nodes.map((n) => [n.id, n]));
    const edges: INetworkEdge[] = [...baseExpand.edges];

    const centerNode = nodes.get(`application:${applicationId}`);
    if (centerNode) centerNode.isCenter = true;

    const otherAppIds = Array.from(new Set(otherLinks.map((ol) => ol.application_id)));
    const otherApps = await this.loadDetailedApplications(otherAppIds);
    const otherAppMap = new Map(otherApps.map((a) => [a.id, a]));

    for (const ol of otherLinks) {
      const oa = otherAppMap.get(ol.application_id);
      if (!oa) continue;
      const oaNodeId = `application:${oa.id}`;
      if (!nodes.has(oaNodeId)) {
        nodes.set(oaNodeId, {
          id: oaNodeId,
          entityId: oa.id,
          nodeType: 'APPLICATION',
          label: `№ ${oa.application_number || 'Raqamsiz'}`,
          sublabel: oa.district?.name || oa.status || 'Ariza',
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
              ol.role === 'SUSPECT' || ol.role === 'DROPPER' ? 'SUSPECT_CLUE' : 'VICTIM_LINK',
            label:
              ol.role === 'DROPPER'
                ? 'Dropper'
                : ol.role === 'SUSPECT'
                  ? 'Gumonlanuvchi'
                  : 'Aloqador',
          });
        }
      }
    }

    // Telefon va Raqamli izlar ro'yxati (UI da ko'rsatish uchun, egasi bilan birga!)
    const clueRelations = [
      ...currentLinks
        .filter((l) => l.phone)
        .map((l) => {
          const matchingOther = otherLinks.filter((ol) => ol.phone_id === l.phone_id);
          return {
            id: l.phone!.id,
            entity_type: 'phone' as const,
            label: 'Telefon raqami',
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
                const oa = otherAppMap.get(mo.application_id);
                return oa
                  ? this.toDossierAppItem(
                      oa,
                      mo.role,
                      mo.source,
                      ['Bir xil telefon raqami'],
                      permCtx,
                    )
                  : null;
              })
              .filter((x): x is DossierApplicationItem => Boolean(x)),
          };
        }),
      ...currentLinks
        .filter((l) => l.identifier)
        .map((l) => {
          const matchingOther = otherLinks.filter((ol) => ol.identifier_id === l.identifier_id);
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
        }),
    ];

    return {
      clue_relations: clueRelations,
      multi_hop_chains: multiHopChains,
      network_graph: {
        nodes: Array.from(nodes.values()),
        edges,
      },
    };
  }
}
