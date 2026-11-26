import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import { type EntityManager, ILike, In, Repository } from 'typeorm';

import {
  AppealType,
  ApplicantType,
  ApplicationRepeatType,
  SubmissionForm,
} from '../../common/enums/appeal-classification.enum';
import { ApplicationDamageType } from '../../common/enums/damage-type.enum';
import { Role } from '../../common/enums/role.enum';
import type { PaginatedResult } from '../../common/interfaces/pagination.interface';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import {
  assertDistrictAccess,
  getAllowedDistrictIds,
} from '../../common/utils/district-scope.util';
import { IntelligenceSyncService } from '../intelligence/intelligence-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SlaQueueService } from '../notifications/sla-queue.service';
import { User } from '../users/user.entity';
import { Application } from './application.entity';
import {
  assertNoChainCycle,
  computeNextRepeatSequence,
  resolveRootApplicationId,
} from './application-chain.util';
import { ApplicationStatusHistory } from './application-status-history.entity';
import {
  ALLOWED_ROW_COLORS,
  type ApplicationRowColor,
  ApplicationsRealtimeService,
} from './applications-realtime.service';
import { ApplicationsRelationsService } from './applications-relations.service';
import { ApplicationsResolverService } from './applications-resolver.service';
import { ApplicationsStatisticsService } from './applications-statistics.service';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { ApplicationDamage } from './damages/application-damage.entity';
import type {
  CreateApplicationDamageDto,
  CreateApplicationDto,
} from './dto/create-application.dto';
import type { UpdateApplicationDto } from './dto/update-application.dto';
import { ApplicationsExcelService } from './export/applications-excel.service';
import { CyberControlShablonExcelService } from './export/cybercontrol-shablon-excel.service';
import { ApplicationExternalSystem } from './external-systems/application-external-system.entity';
import { ExternalSystem } from './external-systems/external-system.entity';
import {
  ApplicationStatus as ApplicationStatusEntity,
  ApplicationStatusCategory,
} from './statuses/application-status.entity';
import { Bank } from './transfers/banks/bank.entity';
import { PaymentProvider } from './transfers/payment_providers/payment_provider.entity';
import { Transfer } from './transfers/transfer.entity';

export type {
  CardRelationSummary,
  CitizenRelationSummary,
  LinkedApplicationSummary,
  RelationGraphEdge,
  RelationGraphNode,
} from './applications-relations.service';

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(ApplicationStatusEntity)
    private readonly statusRepo: Repository<ApplicationStatusEntity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly excelService: ApplicationsExcelService,
    private readonly cyberControlExcelService: CyberControlShablonExcelService,
    private readonly intelligenceSync: IntelligenceSyncService,
    private readonly notificationsService: NotificationsService,
    private readonly slaQueueService: SlaQueueService,
    private readonly resolverService: ApplicationsResolverService,
    private readonly relationsService: ApplicationsRelationsService,
    private readonly statisticsService: ApplicationsStatisticsService,
    private readonly realtimeService: ApplicationsRealtimeService,
  ) {}

  private async resolveApplicationChain(
    txAppRepo: Repository<Application>,
    repeatType: ApplicationRepeatType | undefined,
    parentApplicationId: string | null | undefined,
    currentId?: string,
  ): Promise<{
    repeat_type: ApplicationRepeatType;
    parent_application_id: string | null;
    root_application_id: string | null;
    repeat_sequence: number;
  }> {
    const effectiveRepeatType = repeatType || ApplicationRepeatType.PRIMARY;
    if (effectiveRepeatType === ApplicationRepeatType.PRIMARY) {
      return {
        repeat_type: ApplicationRepeatType.PRIMARY,
        parent_application_id: null,
        root_application_id: null,
        repeat_sequence: 1,
      };
    }

    if (!parentApplicationId) {
      return {
        repeat_type: effectiveRepeatType,
        parent_application_id: null,
        root_application_id: null,
        repeat_sequence: 2,
      };
    }

    const parent = await txAppRepo.findOne({
      where: { id: parentApplicationId, is_deleted: false },
      select: {
        id: true,
        parent_application_id: true,
        root_application_id: true,
        repeat_sequence: true,
      },
    });
    if (!parent) {
      throw new NotFoundException("Bog'lanayotgan avvalgi ariza topilmadi");
    }

    // Sikl himoyasi: ota zanjir bo'ylab yuqoriga yurib joriy ID uchramasligini tekshiramiz
    const ancestorIds = new Set<string>();
    let cursor: string | null | undefined = parent.parent_application_id;
    let hops = 0;
    while (cursor && hops < 30) {
      ancestorIds.add(cursor);
      const anc = await txAppRepo.findOne({
        where: { id: cursor },
        select: { id: true, parent_application_id: true },
      });
      cursor = anc?.parent_application_id || null;
      hops++;
    }
    assertNoChainCycle(currentId, parent.id, ancestorIds);

    const rootId = resolveRootApplicationId(parent);
    const maxSeqQb = txAppRepo
      .createQueryBuilder('a')
      .select('COALESCE(MAX(a.repeat_sequence), 1)', 'maxSeq')
      .where('a.is_deleted = false')
      .andWhere('(a.id = :rootId OR a.root_application_id = :rootId)', { rootId });
    if (currentId) {
      maxSeqQb.andWhere('a.id != :currentId', { currentId });
    }
    const maxSeqRaw = await maxSeqQb.getRawOne<{ maxSeq?: string | number }>();
    const nextSeq = computeNextRepeatSequence(Number(maxSeqRaw?.maxSeq || 1));

    return {
      repeat_type: effectiveRepeatType,
      parent_application_id: parent.id,
      root_application_id: rootId,
      repeat_sequence: nextSeq,
    };
  }

  private async attachChainCounts(items: Application[]): Promise<void> {
    if (items.length === 0) return;
    const rootIds = Array.from(new Set(items.map((item) => item.root_application_id || item.id)));
    if (rootIds.length === 0) return;

    const rows = await this.applicationRepo
      .createQueryBuilder('a')
      .select('COALESCE(a.root_application_id, a.id)', 'rootId')
      .addSelect('COUNT(a.id)::int', 'cnt')
      .where('a.is_deleted = false')
      .andWhere('(a.id IN (:...rootIds) OR a.root_application_id IN (:...rootIds))', {
        rootIds,
      })
      .groupBy('COALESCE(a.root_application_id, a.id)')
      .getRawMany<{ rootId: string; cnt: string | number }>();

    const countMap = new Map<string, number>();
    for (const r of rows) {
      countMap.set(r.rootId, Number(r.cnt || 1));
    }

    for (const item of items) {
      const rootKey = item.root_application_id || item.id;
      item.chain_count = countMap.get(rootKey) ?? 1;
    }
  }

  private async saveApplicationDamages(
    manager: EntityManager,
    applicationId: string,
    damages: CreateApplicationDamageDto[],
  ): Promise<void> {
    const damageRepo = manager.getRepository(ApplicationDamage);
    const bankRepo = manager.getRepository(Bank);
    const providerRepo = manager.getRepository(PaymentProvider);

    const entities: ApplicationDamage[] = [];
    for (let idx = 0; idx < damages.length; idx++) {
      const d = damages[idx];
      const amount = Number(d.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const orgName = d.organization_name?.trim() || null;
      let bankId = d.bank_id || null;
      let providerId = d.payment_provider_id || null;

      if (orgName && !bankId) {
        const matchedBank = await bankRepo.findOne({ where: { name: ILike(orgName) } });
        if (matchedBank) bankId = matchedBank.id;
      }
      if (orgName && !providerId) {
        const matchedProvider = await providerRepo.findOne({ where: { name: ILike(orgName) } });
        if (matchedProvider) providerId = matchedProvider.id;
      }

      entities.push(
        damageRepo.create({
          application_id: applicationId,
          damage_type: d.damage_type || ApplicationDamageType.ONLINE_CREDIT,
          organization_name: orgName,
          bank_id: bankId,
          payment_provider_id: providerId,
          amount,
          currency: (d.currency || 'UZS').trim().toUpperCase() || 'UZS',
          contract_number: d.contract_number?.trim() || null,
          damage_date: d.damage_date?.trim() || null,
          description: d.description?.trim() || null,
          order: d.order ?? idx,
        }),
      );
    }

    if (entities.length > 0) {
      await damageRepo.save(entities);
    }
  }

  private async syncApplicationExternalSystems(
    manager: EntityManager,
    applicationId: string,
    externalSystemIds: string[],
    enteredByUserId: string | null,
  ): Promise<void> {
    const linkRepo = manager.getRepository(ApplicationExternalSystem);
    const systemRepo = manager.getRepository(ExternalSystem);

    const uniqueValidIds = Array.from(
      new Set((externalSystemIds || []).map((id) => id?.trim()).filter((id) => isUUID(id))),
    );

    const validSystemIds =
      uniqueValidIds.length > 0
        ? (await systemRepo.find({ where: { id: In(uniqueValidIds) }, select: { id: true } })).map(
            (s) => s.id,
          )
        : [];
    const targetSet = new Set(validSystemIds);

    const existingLinks = await linkRepo.find({ where: { application_id: applicationId } });
    const existingSet = new Set(existingLinks.map((l) => l.external_system_id));

    const toRemoveIds = existingLinks
      .filter((l) => !targetSet.has(l.external_system_id))
      .map((l) => l.id);
    if (toRemoveIds.length > 0) {
      await linkRepo.delete({ id: In(toRemoveIds) });
    }

    const toInsert = validSystemIds
      .filter((sysId) => !existingSet.has(sysId))
      .map((sysId) =>
        linkRepo.create({
          application_id: applicationId,
          external_system_id: sysId,
          entered_at: new Date(),
          entered_by_id: enteredByUserId,
        }),
      );
    if (toInsert.length > 0) {
      await linkRepo.save(toInsert);
    }
  }

  async toggleExternalSystem(
    applicationId: string,
    externalSystemId: string,
    entered: boolean,
    currentUser?: JwtAccessPayload,
  ): Promise<Application> {
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException(
        "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
      );
    }

    const application = await this.findOne(applicationId, currentUser);
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const assignedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
      assertDistrictAccess(
        assignedDistrictIds,
        application.district_id,
        "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalarini tahrirlashingiz mumkin",
      );
    }

    const user = currentUser
      ? await this.userRepo.findOne({ where: { auth_id: currentUser.sub } })
      : null;

    await this.applicationRepo.manager.transaction(async (manager) => {
      const systemRepo = manager.getRepository(ExternalSystem);
      const linkRepo = manager.getRepository(ApplicationExternalSystem);

      const sys = await systemRepo.findOne({ where: { id: externalSystemId } });
      if (!sys) {
        throw new NotFoundException('Tashqi tizim topilmadi');
      }

      const existing = await linkRepo.findOne({
        where: { application_id: applicationId, external_system_id: externalSystemId },
      });

      if (entered) {
        if (!existing) {
          await linkRepo.save(
            linkRepo.create({
              application_id: applicationId,
              external_system_id: externalSystemId,
              entered_at: new Date(),
              entered_by_id: user?.id || null,
            }),
          );
        }
      } else if (existing) {
        await linkRepo.remove(existing);
      }
    });

    return this.findOne(applicationId, currentUser);
  }

  async create(dto: CreateApplicationDto, currentUser?: JwtAccessPayload): Promise<Application> {
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException(
        "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
      );
    }

    // RBAC tekshiruvi barcha DB yozishlardan OLDIN bajariladi
    let creatorUserId: string | null = null;
    let assignedDistrictIds: string[] | null = null;
    if (currentUser) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      creatorUserId = user?.id || null;
      if (currentUser.role === Role.DISTRICT_OFFICER) {
        assignedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
        if (dto.district_id) {
          assertDistrictAccess(
            assignedDistrictIds,
            dto.district_id,
            "Siz faqat o'zingizga biriktirilgan tuman(lar) uchun ariza yarata olasiz",
          );
        }
      }
    }

    const {
      custom_fields,
      damages,
      external_system_ids,
      date,
      deadline_at,
      sla_days,
      prosecutor_approval_date,
      decision_date,
      status_change_note: _status_change_note,
      citizen_data: _citizen_data,
      district_data: _district_data,
      crime_data: _crime_data,
      card_data: _card_data,
      transfer_data: _transfer_data,
      workplace_data: _workplace_data,
      ...applicationData
    } = dto;

    const appNumber = applicationData.application_number?.trim() || null;

    const savedId = await this.applicationRepo.manager.transaction(async (manager) => {
      const txAppRepo = manager.getRepository(Application);
      const txStatusRepo = manager.getRepository(ApplicationStatusEntity);
      const txTransferRepo = manager.getRepository(Transfer);
      const txHistoryRepo = manager.getRepository(ApplicationStatusHistory);
      const txCustomFieldRepo = manager.getRepository(ApplicationCustomField);

      const resolved = await this.resolverService.resolvePrimaryModels(dto, undefined, manager);

      if (assignedDistrictIds !== null) {
        assertDistrictAccess(
          assignedDistrictIds,
          resolved.district_id || dto.district_id,
          "Siz faqat o'zingizga biriktirilgan tuman(lar) uchun ariza yarata olasiz",
        );
      }

      const statusObj = resolved.status_id
        ? await txStatusRepo.findOne({ where: { id: resolved.status_id } })
        : null;

      const baseDate = date ? new Date(date) : new Date();
      const effectiveSlaDays = sla_days ?? statusObj?.default_sla_days ?? 10;
      let computedDeadline: Date | null = null;
      if (deadline_at) {
        computedDeadline = new Date(deadline_at);
      } else if (!statusObj || statusObj.tracks_sla) {
        computedDeadline = new Date(baseDate.getTime() + effectiveSlaDays * 24 * 60 * 60 * 1000);
      }
      const isClosedStatus = statusObj?.category === ApplicationStatusCategory.CLOSED;

      const chainResolved = await this.resolveApplicationChain(
        txAppRepo,
        dto.repeat_type,
        dto.parent_application_id,
      );

      const application = txAppRepo.create({
        ...applicationData,
        ...resolved,
        appeal_type: dto.appeal_type || AppealType.APPEAL,
        submission_form: dto.submission_form || SubmissionForm.WRITTEN,
        applicant_type: dto.applicant_type || ApplicantType.INDIVIDUAL,
        ...chainResolved,
        repeat_reason: dto.repeat_reason?.trim() || null,
        is_review_terminated: Boolean(dto.is_review_terminated),
        termination_note: dto.termination_note?.trim() || null,
        created_by_id: creatorUserId,
        is_deleted: false,
        application_number: appNumber,
        date: baseDate,
        sla_days: effectiveSlaDays,
        deadline_at: computedDeadline,
        prosecutor_approval_date: prosecutor_approval_date
          ? new Date(prosecutor_approval_date)
          : null,
        decision_date: decision_date ? new Date(decision_date) : null,
        closed_at: isClosedStatus ? new Date() : null,
      });

      const saved = await txAppRepo.save(application);

      if (resolved.transfer_id) {
        await txTransferRepo.update(resolved.transfer_id, { application_id: saved.id });
      }

      await txHistoryRepo.save(
        txHistoryRepo.create({
          application_id: saved.id,
          action: 'CREATED',
          to_status_id: statusObj?.id || resolved.status_id || null,
          to_status_name: statusObj?.name || saved.status || 'Yangi',
          new_deadline_at: computedDeadline,
          note: 'Ariza ro‘yxatga olindi',
          changed_by_id: creatorUserId,
        }),
      );

      if (custom_fields && custom_fields.length > 0) {
        const fieldEntities = await this.resolverService.processCustomFields(
          custom_fields,
          saved.id,
          manager,
        );
        await txCustomFieldRepo.save(fieldEntities);
      }

      if (damages && damages.length > 0) {
        await this.saveApplicationDamages(manager, saved.id, damages);
      }

      if (external_system_ids && external_system_ids.length > 0) {
        await this.syncApplicationExternalSystems(
          manager,
          saved.id,
          external_system_ids,
          creatorUserId,
        );
      }

      return saved.id;
    });

    await this.intelligenceSync.syncApplicationById(savedId);
    void this.slaQueueService.scheduleForApplication(savedId);
    void this.notificationsService.onApplicationCreated(savedId, currentUser?.sub);
    return this.findOne(savedId, currentUser);
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
          min_amount?: string | number;
          max_amount?: string | number;
          relations_filter?: string;
          sla_filter?: string;
          repeat_type?: string;
          appeal_type?: string;
          submission_form?: string;
          awareness_status_id?: string;
          external_system_id?: string;
          external_system_status?: string;
          missing_external_system_id?: string;
          row_color?: string;
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
    let min_amount: string | number | undefined;
    let max_amount: string | number | undefined;
    let relations_filter: string | undefined;
    let sla_filter: string | undefined;
    let repeat_type: string | undefined;
    let appeal_type: string | undefined;
    let submission_form: string | undefined;
    let awareness_status_id: string | undefined;
    let external_system_id: string | undefined;
    let external_system_status: string | undefined;
    let missing_external_system_id: string | undefined;
    let row_color: string | undefined;

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
      min_amount = pageOrParams.min_amount;
      max_amount = pageOrParams.max_amount;
      relations_filter = pageOrParams.relations_filter;
      sla_filter = pageOrParams.sla_filter;
      repeat_type = pageOrParams.repeat_type;
      appeal_type = pageOrParams.appeal_type;
      submission_form = pageOrParams.submission_form;
      awareness_status_id = pageOrParams.awareness_status_id;
      external_system_id = pageOrParams.external_system_id;
      external_system_status = pageOrParams.external_system_status;
      missing_external_system_id = pageOrParams.missing_external_system_id;
      row_color = pageOrParams.row_color;
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

    let allowedDistrictIds: string[] | null = null;
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      allowedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
      if (allowedDistrictIds.length > 0) {
        qb.andWhere('app.district_id IN (:...userDistricts)', {
          userDistricts: allowedDistrictIds,
        });
      } else {
        qb.andWhere('1 = 0');
      }
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      qb.andWhere(
        '(app.application_number ILIKE :q OR app.description ILIKE :q OR app.officer_notes ILIKE :q OR citizen.full_name ILIKE :q OR citizen.phone_number ILIKE :q OR citizen.passport ILIKE :q)',
        { q },
      );
    }

    const stVal = status_id || status;
    if (stVal && stVal.trim()) {
      const val = stVal.trim();
      if (isUUID(val)) {
        qb.andWhere('app.status_id = :stVal', { stVal: val });
      } else {
        qb.andWhere(
          '(app.status ILIKE :stVal OR application_status.code ILIKE :stVal OR application_status.name ILIKE :stVal)',
          { stVal: val },
        );
      }
    }

    if (district_id && district_id.trim()) {
      qb.andWhere('app.district_id = :district_id', { district_id: district_id.trim() });
    }

    // SLA muddat nazorati filtri
    if (sla_filter && sla_filter.trim()) {
      const sf = sla_filter.trim().toLowerCase();
      const now = new Date();
      if (sf === 'overdue') {
        qb.andWhere(
          '(application_status.tracks_sla = true OR application_status.id IS NULL) AND app.deadline_at IS NOT NULL AND app.deadline_at < :slaNow',
          { slaNow: now },
        );
      } else if (sf === 'due_24h') {
        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        qb.andWhere(
          '(application_status.tracks_sla = true OR application_status.id IS NULL) AND app.deadline_at >= :slaNow AND app.deadline_at <= :slaIn24h',
          { slaNow: now, slaIn24h: in24h },
        );
      } else if (sf === 'due_72h') {
        const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
        qb.andWhere(
          '(application_status.tracks_sla = true OR application_status.id IS NULL) AND app.deadline_at >= :slaNow AND app.deadline_at <= :slaIn72h',
          { slaNow: now, slaIn72h: in72h },
        );
      } else if (sf === 'extended') {
        qb.andWhere("(app.extended_until IS NOT NULL OR application_status.category = 'EXTENDED')");
      } else if (sf === 'active') {
        qb.andWhere(
          "(application_status.tracks_sla = true OR application_status.id IS NULL) AND app.deadline_at IS NOT NULL AND app.deadline_at >= :slaNow AND app.extended_until IS NULL AND (application_status.category IS NULL OR application_status.category != 'EXTENDED')",
          { slaNow: now },
        );
      }
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
      qb.andWhere('citizen.full_name ILIKE :cName', { cName });
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

    const lossSubquery = `((SELECT COALESCE(SUM(t.amount), 0) FROM transfers t WHERE t.id = app.transfer_id OR t.application_id = app.id) + (SELECT COALESCE(SUM(d.amount), 0) FROM application_damages d WHERE d.application_id = app.id))`;
    if (
      min_amount !== undefined &&
      min_amount !== null &&
      String(min_amount).trim() !== '' &&
      !Number.isNaN(Number(min_amount))
    ) {
      qb.andWhere(`${lossSubquery} >= :minAmount`, { minAmount: Number(min_amount) });
    }
    if (
      max_amount !== undefined &&
      max_amount !== null &&
      String(max_amount).trim() !== '' &&
      !Number.isNaN(Number(max_amount))
    ) {
      qb.andWhere(`${lossSubquery} <= :maxAmount`, { maxAmount: Number(max_amount) });
    }

    if (repeat_type && repeat_type.trim()) {
      qb.andWhere('app.repeat_type = :repeat_type', {
        repeat_type: repeat_type.trim().toUpperCase(),
      });
    }
    if (appeal_type && appeal_type.trim()) {
      qb.andWhere('app.appeal_type = :appeal_type', {
        appeal_type: appeal_type.trim().toUpperCase(),
      });
    }
    if (submission_form && submission_form.trim()) {
      qb.andWhere('app.submission_form = :submission_form', {
        submission_form: submission_form.trim().toUpperCase(),
      });
    }
    if (awareness_status_id && isUUID(awareness_status_id.trim())) {
      qb.andWhere('app.awareness_status_id = :awareness_status_id', {
        awareness_status_id: awareness_status_id.trim(),
      });
    }

    const effectiveExtSysId = (missing_external_system_id || external_system_id || '').trim();
    if (effectiveExtSysId && isUUID(effectiveExtSysId)) {
      const wantEntered =
        !missing_external_system_id &&
        (external_system_status || '').trim().toLowerCase() === 'entered';
      if (wantEntered) {
        qb.andWhere(
          `EXISTS (SELECT 1 FROM application_external_systems aes WHERE aes.application_id = app.id AND aes.external_system_id = :extSysId)`,
          { extSysId: effectiveExtSysId },
        );
      } else {
        qb.andWhere(
          `NOT EXISTS (SELECT 1 FROM application_external_systems aes WHERE aes.application_id = app.id AND aes.external_system_id = :extSysId)`,
          { extSysId: effectiveExtSysId },
        );
      }
    }

    if (row_color && row_color.trim()) {
      const rc = row_color.trim().toLowerCase();
      if (rc === 'any') {
        qb.andWhere('app.row_color IS NOT NULL');
      } else if (rc === 'none') {
        qb.andWhere('app.row_color IS NULL');
      } else if ((ALLOWED_ROW_COLORS as readonly string[]).includes(rc)) {
        qb.andWhere('app.row_color = :row_color', { row_color: rc });
      }
    }

    qb.orderBy('app.created_at', 'DESC');

    const relations = {
      application_status: true,
      awareness_status: true,
      parent_application: true,
      root_application: true,
      documents: true,
      source: true,
      department_service: true,
      rejection_reason: true,
      decision_type: true,
      workplace: true,
      created_by: true,
      citizen: {
        district: true,
        neighborhood: true,
        occupation_category: true,
        occupation: true,
        workplace: true,
      },
      district: true,
      crime: true,
      crime_method: { fields: true },
      card: { bank: true, citizen: true },
      damages: { bank: true, payment_provider: true },
      external_systems: { external_system: true },
      transfer: {
        payment_provider: true,
        sender_card: { bank: true, citizen: true },
        receiver_card: { bank: true, citizen: true },
        receiver_identifier: true,
        custom_fields: {
          bank: true,
          card: true,
          citizen: true,
        },
      },
      custom_fields: {
        citizen: {
          district: true,
          neighborhood: true,
          occupation_category: true,
          occupation: true,
          workplace: true,
        },
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
      await this.relationsService.attachRelationsSummaries(allItems, allowedDistrictIds);
      await this.attachChainCounts(allItems);

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
      await this.relationsService.attachRelationsSummaries(items, allowedDistrictIds);
      await this.attachChainCounts(items);
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
      min_amount?: string | number;
      max_amount?: string | number;
      relations_filter?: string;
      repeat_type?: string;
      appeal_type?: string;
      submission_form?: string;
      awareness_status_id?: string;
      external_system_id?: string;
      external_system_status?: string;
      missing_external_system_id?: string;
      row_color?: string;
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

    const appIds = result.items.map((a) => a.id);
    const extraTransfersMap = new Map<string, Transfer[]>();
    if (appIds.length > 0) {
      const linkedTransfers = await this.transferRepo.find({
        where: { application_id: In(appIds) },
        relations: {
          payment_provider: true,
          sender_card: { bank: true, citizen: true },
          receiver_card: { bank: true, citizen: true },
          receiver_identifier: true,
        },
        order: { transfer_at: 'ASC', created_at: 'ASC' },
      });
      for (const tr of linkedTransfers) {
        if (!tr.application_id) continue;
        const list = extraTransfersMap.get(tr.application_id) ?? [];
        list.push(tr);
        extraTransfersMap.set(tr.application_id, list);
      }
    }

    const workbook = await this.excelService.generateWorkbook(result.items, extraTransfersMap);

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
          neighborhood: true,
          occupation_category: true,
          occupation: true,
          workplace: true,
        },
        workplace: true,
        district: true,
        crime: true,
        crime_method: true,
        damages: true,
        transfer: true,
        custom_fields: {
          citizen: {
            district: true,
            neighborhood: true,
            occupation_category: true,
            occupation: true,
            workplace: true,
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

  async getRelations(id: string, currentUser?: JwtAccessPayload) {
    const currentApp = await this.findOne(id, currentUser);
    return this.relationsService.getRelations(currentApp, currentUser);
  }

  public identifyBank(cardNumber?: string | null): string {
    return this.relationsService.identifyBank(cardNumber);
  }

  async findOne(id: string, currentUser?: JwtAccessPayload): Promise<Application> {
    const application = await this.applicationRepo.findOne({
      where: { id, is_deleted: false },
      relations: {
        application_status: true,
        awareness_status: true,
        parent_application: true,
        root_application: true,
        status_history: { changed_by: true },
        documents: true,
        source: true,
        department_service: true,
        rejection_reason: true,
        decision_type: true,
        workplace: {
          district: true,
          neighborhood: true,
          occupation_category: true,
        },
        created_by: true,
        citizen: {
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
        district: true,
        crime: true,
        crime_method: { fields: true },
        card: { bank: true, citizen: true },
        damages: { bank: true, payment_provider: true },
        external_systems: { external_system: true },
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
            neighborhood: true,
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
      const assignedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
      assertDistrictAccess(
        assignedDistrictIds,
        application.district_id,
        "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalarini ko'rishingiz mumkin",
      );
    }

    if (application.status_history && application.status_history.length > 1) {
      application.status_history.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }

    await this.attachChainCounts([application]);
    return application;
  }

  /**
   * Murojaat zanjiri (Birlamchi -> Takroriy -> Dublikat -> Qo'shimcha) xronologik ro'yxati
   */
  async getApplicationChain(id: string, currentUser?: JwtAccessPayload) {
    const current = await this.findOne(id, currentUser);
    const rootId = current.root_application_id || current.id;

    let assignedDistrictIds: string[] | null = null;
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      assignedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
    }

    const qb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.application_status', 'application_status')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.source', 'source')
      .leftJoinAndSelect('app.decision_type', 'decision_type')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .where('app.is_deleted = false')
      .andWhere('(app.id = :rootId OR app.root_application_id = :rootId)', { rootId })
      .orderBy('app.repeat_sequence', 'ASC')
      .addOrderBy('COALESCE(app.date, app.created_at)', 'ASC')
      .addOrderBy('app.created_at', 'ASC');

    if (assignedDistrictIds !== null) {
      if (assignedDistrictIds.length > 0) {
        qb.andWhere('app.district_id IN (:...userDistricts)', {
          userDistricts: assignedDistrictIds,
        });
      } else {
        qb.andWhere('app.id = :currentId', { currentId: current.id });
      }
    }

    const chainApps = await qb.getMany();

    return {
      root_application_id: rootId,
      current_application_id: current.id,
      total: chainApps.length,
      items: chainApps.map((a) => ({
        id: a.id,
        application_number: a.application_number,
        date: a.date || a.created_at,
        appeal_type: a.appeal_type,
        submission_form: a.submission_form,
        applicant_type: a.applicant_type,
        repeat_type: a.repeat_type,
        repeat_sequence: a.repeat_sequence,
        repeat_reason: a.repeat_reason,
        is_review_terminated: a.is_review_terminated,
        termination_note: a.termination_note,
        parent_application_id: a.parent_application_id,
        status: a.status,
        status_name: a.application_status?.name || a.status || 'Yangi',
        status_color: a.application_status?.color || 'blue',
        district_name: a.district?.name || null,
        source_name: a.source?.name || null,
        decision_type_name: a.decision_type?.name || null,
        decision_date: a.decision_date,
        citizen_name: a.citizen?.full_name?.trim() || null,
        transfer_amount: a.transfer?.amount ? Number(a.transfer.amount) : 0,
        transfer_currency: a.transfer?.currency || 'UZS',
      })),
    };
  }

  /**
   * Fuqaroning avvalgi arizalari (yangi ariza yaratayotganda takroriylikni avtomatik aniqlash uchun)
   */
  async findByCitizen(citizenId: string, excludeId?: string, currentUser?: JwtAccessPayload) {
    let assignedDistrictIds: string[] | null = null;
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      assignedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
      if (assignedDistrictIds && assignedDistrictIds.length === 0) {
        return [];
      }
    }

    const qb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.application_status', 'application_status')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.crime', 'crime')
      .leftJoinAndSelect('app.source', 'source')
      .where('app.is_deleted = false')
      .andWhere('app.citizen_id = :citizenId', { citizenId })
      .orderBy('COALESCE(app.date, app.created_at)', 'DESC')
      .take(20);

    if (excludeId && isUUID(excludeId)) {
      qb.andWhere('app.id != :excludeId', { excludeId });
    }
    if (assignedDistrictIds !== null) {
      qb.andWhere('app.district_id IN (:...userDistricts)', {
        userDistricts: assignedDistrictIds,
      });
    }

    const apps = await qb.getMany();
    return apps.map((a) => ({
      id: a.id,
      application_number: a.application_number,
      date: a.date || a.created_at,
      appeal_type: a.appeal_type,
      repeat_type: a.repeat_type,
      repeat_sequence: a.repeat_sequence,
      root_application_id: a.root_application_id,
      status_name: a.application_status?.name || a.status || 'Yangi',
      status_color: a.application_status?.color || 'blue',
      district_id: a.district_id,
      district_name: a.district?.name || null,
      crime_id: a.crime_id,
      crime_name: a.crime?.article || a.crime?.title || null,
      crime_method_id: a.crime_method_id,
      source_name: a.source?.name || null,
      description: a.description ? a.description.slice(0, 140) : null,
    }));
  }

  async extendDeadline(
    id: string,
    dto: {
      new_deadline_at?: string;
      extend_days?: number;
      reason: string;
      prosecutor_approval_number?: string;
      prosecutor_approval_date?: string;
      switch_to_extended_status?: boolean;
    },
    currentUser?: JwtAccessPayload,
  ): Promise<Application> {
    const application = await this.findOne(id, currentUser);

    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException(
        "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
      );
    }

    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Muddatni uzaytirish sababi kiritilishi shart');
    }

    const baseDate = application.date || application.created_at || new Date();
    const oldDeadline = application.deadline_at;
    let newDeadline: Date;

    if (dto.new_deadline_at) {
      newDeadline = new Date(dto.new_deadline_at);
    } else {
      const days = Math.max(1, Math.min(365, Number(dto.extend_days) || 30));
      newDeadline = new Date(new Date(baseDate).getTime() + days * 24 * 60 * 60 * 1000);
    }

    if (Number.isNaN(newDeadline.getTime())) {
      throw new BadRequestException('Yangi muddat sanasi noto‘g‘ri');
    }

    const actorUser = currentUser
      ? await this.userRepo.findOne({ where: { auth_id: currentUser.sub } })
      : null;

    const oldStatusId = application.status_id;
    const oldStatusName = application.application_status?.name || application.status || null;
    let targetStatus = application.application_status;

    if (dto.switch_to_extended_status !== false) {
      const extendedStatus = await this.statusRepo.findOne({
        where: [{ code: 'MUDDATI_UZAYTIRILGAN' }, { category: ApplicationStatusCategory.EXTENDED }],
      });
      if (extendedStatus) {
        targetStatus = extendedStatus;
        application.status_id = extendedStatus.id;
        application.status = extendedStatus.code || extendedStatus.name;
      }
    }

    const totalDays = Math.max(
      1,
      Math.round((newDeadline.getTime() - new Date(baseDate).getTime()) / (24 * 60 * 60 * 1000)),
    );

    delete (application as unknown as Record<string, unknown>).application_status;
    delete (application as unknown as Record<string, unknown>).status_history;

    application.deadline_at = newDeadline;
    application.extended_until = newDeadline;
    application.extension_reason = reason;
    application.sla_days = totalDays;
    application.prosecutor_approval_number = dto.prosecutor_approval_number?.trim() || null;
    application.prosecutor_approval_date = dto.prosecutor_approval_date
      ? new Date(dto.prosecutor_approval_date)
      : null;

    await this.applicationRepo.manager.transaction(async (manager) => {
      await manager.getRepository(Application).save(application);

      await manager.getRepository(ApplicationStatusHistory).save(
        manager.getRepository(ApplicationStatusHistory).create({
          application_id: id,
          action: 'DEADLINE_EXTENDED',
          from_status_id: oldStatusId,
          from_status_name: oldStatusName,
          to_status_id: targetStatus?.id || application.status_id,
          to_status_name: targetStatus?.name || application.status,
          old_deadline_at: oldDeadline,
          new_deadline_at: newDeadline,
          prosecutor_approval_number: application.prosecutor_approval_number,
          prosecutor_approval_date: application.prosecutor_approval_date,
          note: reason,
          changed_by_id: actorUser?.id || null,
        }),
      );
    });

    void this.slaQueueService.scheduleForApplication(id);
    const fresh = await this.findOne(id, currentUser);
    void this.notificationsService.onDeadlineExtended(fresh, newDeadline, reason, currentUser?.sub);
    return fresh;
  }

  async getSlaOverview(currentUser?: JwtAccessPayload) {
    return this.statisticsService.getSlaOverview(currentUser);
  }

  async update(
    id: string,
    dto: UpdateApplicationDto,
    currentUser?: JwtAccessPayload,
  ): Promise<Application> {
    const application = await this.findOne(id, currentUser);

    if (currentUser) {
      if (currentUser.role === Role.BOSS) {
        throw new ForbiddenException(
          "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
        );
      }
      if (currentUser.role === Role.DISTRICT_OFFICER) {
        const assignedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
        assertDistrictAccess(
          assignedDistrictIds,
          application.district_id,
          "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalarini tahrirlashingiz mumkin",
        );
        if (dto.district_id !== undefined) {
          assertDistrictAccess(
            assignedDistrictIds,
            dto.district_id,
            "Siz arizani boshqa tumanga o'tkaza olmaysiz",
          );
        }
      }
    }

    const oldStatusId = application.status_id;
    const oldStatusName = application.application_status?.name || application.status || null;
    const oldDeadlineAt = application.deadline_at;

    const {
      custom_fields,
      damages,
      external_system_ids,
      date,
      deadline_at,
      sla_days,
      prosecutor_approval_date,
      decision_date,
      status_change_note,
      citizen_data: _citizen_data,
      district_data: _district_data,
      crime_data: _crime_data,
      card_data: _card_data,
      transfer_data: _transfer_data,
      workplace_data: _workplace_data,
      ...applicationData
    } = dto;

    const { statusChanged, deadlineChanged } = await this.applicationRepo.manager.transaction(
      async (manager) => {
        const txAppRepo = manager.getRepository(Application);
        const txStatusRepo = manager.getRepository(ApplicationStatusEntity);
        const txHistoryRepo = manager.getRepository(ApplicationStatusHistory);
        const txCustomFieldRepo = manager.getRepository(ApplicationCustomField);

        const resolved = await this.resolverService.resolvePrimaryModels(dto, id, manager);

        // Status o'zgarayotgan bo'lsa, dinamik status qoidalarini tekshiramiz
        const nextStatusId = resolved.status_id || application.status_id;
        const nextStatusObj = nextStatusId
          ? await txStatusRepo.findOne({ where: { id: nextStatusId } })
          : null;
        const isStatusChanged = Boolean(nextStatusId && nextStatusId !== oldStatusId);

        const effectiveDecisionTypeId =
          resolved.decision_type_id !== undefined
            ? resolved.decision_type_id
            : application.decision_type_id;
        const effectiveRejectionReasonId =
          resolved.rejection_reason_id !== undefined
            ? resolved.rejection_reason_id
            : application.rejection_reason_id;

        if (isStatusChanged && nextStatusObj) {
          if (nextStatusObj.requires_decision && !effectiveDecisionTypeId) {
            throw new BadRequestException(
              `«${nextStatusObj.name}» holatiga o‘tkazish uchun yakuniy qaror turini tanlash majburiy`,
            );
          }
          if (nextStatusObj.requires_rejection_reason && !effectiveRejectionReasonId) {
            throw new BadRequestException(
              `«${nextStatusObj.name}» holatiga o‘tkazish uchun rad etish sababini tanlash majburiy`,
            );
          }
        }

        // Stale loaded relation ob'ektlarini olib tashlaymiz
        delete (application as unknown as Record<string, unknown>).citizen;
        delete (application as unknown as Record<string, unknown>).district;
        delete (application as unknown as Record<string, unknown>).crime;
        delete (application as unknown as Record<string, unknown>).crime_method;
        delete (application as unknown as Record<string, unknown>).card;
        delete (application as unknown as Record<string, unknown>).transfer;
        delete (application as unknown as Record<string, unknown>).application_status;
        delete (application as unknown as Record<string, unknown>).status_history;
        delete (application as unknown as Record<string, unknown>).source;
        delete (application as unknown as Record<string, unknown>).department_service;
        delete (application as unknown as Record<string, unknown>).rejection_reason;
        delete (application as unknown as Record<string, unknown>).decision_type;
        delete (application as unknown as Record<string, unknown>).workplace;
        delete (application as unknown as Record<string, unknown>).parent_application;
        delete (application as unknown as Record<string, unknown>).root_application;
        delete (application as unknown as Record<string, unknown>).awareness_status;

        const prevRepeatType = application.repeat_type;
        const prevParentId = application.parent_application_id;

        Object.assign(application, applicationData, resolved);

        if (dto.repeat_type !== undefined || dto.parent_application_id !== undefined) {
          const nextRepeatType = dto.repeat_type ?? application.repeat_type;
          const nextParentId =
            dto.parent_application_id !== undefined
              ? dto.parent_application_id
              : application.parent_application_id;

          if (nextRepeatType !== prevRepeatType || nextParentId !== prevParentId) {
            const chainResolved = await this.resolveApplicationChain(
              txAppRepo,
              nextRepeatType,
              nextParentId,
              id,
            );
            application.repeat_type = chainResolved.repeat_type;
            application.parent_application_id = chainResolved.parent_application_id;
            application.root_application_id = chainResolved.root_application_id;
            application.repeat_sequence = chainResolved.repeat_sequence;
          }
        }
        if (dto.repeat_reason !== undefined) {
          application.repeat_reason = dto.repeat_reason ? dto.repeat_reason.trim() : null;
        }
        if (dto.termination_note !== undefined) {
          application.termination_note = dto.termination_note ? dto.termination_note.trim() : null;
        }
        if (applicationData.application_number !== undefined) {
          application.application_number = applicationData.application_number
            ? applicationData.application_number.trim()
            : null;
        }
        if (date) {
          application.date = new Date(date);
        }
        if (prosecutor_approval_date !== undefined) {
          application.prosecutor_approval_date = prosecutor_approval_date
            ? new Date(prosecutor_approval_date)
            : null;
        }
        if (decision_date !== undefined) {
          application.decision_date = decision_date ? new Date(decision_date) : null;
        }
        if (deadline_at !== undefined) {
          application.deadline_at = deadline_at ? new Date(deadline_at) : null;
        } else if (sla_days !== undefined && sla_days !== null) {
          const base = application.date || application.created_at || new Date();
          application.sla_days = sla_days;
          application.deadline_at = new Date(
            new Date(base).getTime() + sla_days * 24 * 60 * 60 * 1000,
          );
        }
        if (sla_days !== undefined) {
          application.sla_days = sla_days;
        }

        if (nextStatusObj) {
          if (nextStatusObj.category === ApplicationStatusCategory.CLOSED) {
            application.closed_at = application.closed_at || new Date();
          } else if (isStatusChanged) {
            application.closed_at = null;
          }
        }

        await txAppRepo.save(application);

        const isDeadlineChanged =
          (oldDeadlineAt?.getTime() || null) !== (application.deadline_at?.getTime() || null);
        if (isStatusChanged || isDeadlineChanged) {
          const actorUser = currentUser
            ? await this.userRepo.findOne({ where: { auth_id: currentUser.sub } })
            : null;
          const isClosed = nextStatusObj?.category === ApplicationStatusCategory.CLOSED;
          await txHistoryRepo.save(
            txHistoryRepo.create({
              application_id: id,
              action: isClosed ? 'CLOSED' : isStatusChanged ? 'STATUS_CHANGED' : 'DEADLINE_CHANGED',
              from_status_id: oldStatusId,
              from_status_name: oldStatusName,
              to_status_id: nextStatusObj?.id || application.status_id,
              to_status_name: nextStatusObj?.name || application.status,
              old_deadline_at: oldDeadlineAt,
              new_deadline_at: application.deadline_at,
              decision_number: application.decision_number,
              decision_date: application.decision_date,
              note: status_change_note?.trim() || application.decision_note || null,
              changed_by_id: actorUser?.id || null,
            }),
          );
        }

        if (custom_fields !== undefined) {
          await txCustomFieldRepo.delete({ application_id: id });
          if (custom_fields.length > 0) {
            const fieldEntities = await this.resolverService.processCustomFields(
              custom_fields,
              id,
              manager,
            );
            await txCustomFieldRepo.save(fieldEntities);
          }
        }

        if (damages !== undefined) {
          await manager.getRepository(ApplicationDamage).delete({ application_id: id });
          if (damages.length > 0) {
            await this.saveApplicationDamages(manager, id, damages);
          }
        }

        if (external_system_ids !== undefined) {
          const actor = currentUser
            ? await manager.getRepository(User).findOne({ where: { auth_id: currentUser.sub } })
            : null;
          await this.syncApplicationExternalSystems(
            manager,
            id,
            external_system_ids,
            actor?.id || null,
          );
        }

        return { statusChanged: isStatusChanged, deadlineChanged: isDeadlineChanged };
      },
    );

    await this.intelligenceSync.syncApplicationById(id);
    if (statusChanged || deadlineChanged) {
      void this.slaQueueService.scheduleForApplication(id);
    }
    if (dto.status || dto.status_id) {
      const updatedApp = await this.findOne(id);
      const statusLabel = updatedApp.application_status?.name || updatedApp.status || '';
      if (statusLabel) {
        void this.notificationsService.onApplicationStatusChanged(
          id,
          statusLabel,
          currentUser?.sub,
        );
      }
      return updatedApp;
    }
    return this.findOne(id);
  }

  async remove(
    id: string,
    currentUser?: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    const application = await this.findOne(id, currentUser);

    if (currentUser) {
      if (currentUser.role === Role.BOSS) {
        throw new ForbiddenException(
          "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
        );
      }

      if (currentUser.role !== Role.SUPER_ADMIN && currentUser.role !== Role.ADMIN) {
        const user = await this.userRepo.findOne({ where: { auth_id: currentUser.sub } });
        const currentUserId = user?.id;
        if (!application.created_by_id || application.created_by_id !== currentUserId) {
          throw new ForbiddenException("Faqat o'zingiz yaratgan arizani o'chira olasiz");
        }
        application.is_deleted = true;
        application.deleted_at = new Date();
        application.deleted_by_id = currentUserId || null;
        await this.applicationRepo.save(application);
        await this.intelligenceSync.syncApplicationById(id);
        void this.slaQueueService.cancelForApplication(id);
        return { success: true, message: "Ariza arxivlandi (o'chirildi)" };
      }
    }

    const adminUser = currentUser
      ? await this.userRepo.findOne({ where: { auth_id: currentUser.sub } })
      : null;
    application.is_deleted = true;
    application.deleted_at = new Date();
    application.deleted_by_id = adminUser?.id || null;
    await this.applicationRepo.save(application);
    await this.intelligenceSync.syncApplicationById(id);
    void this.slaQueueService.cancelForApplication(id);
    return { success: true, message: "Ariza muvaffaqiyatli o'chirildi" };
  }

  async getRealtimeDistrictScope(currentUser?: JwtAccessPayload): Promise<string[] | null> {
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      return getAllowedDistrictIds(this.userRepo, currentUser);
    }
    return null;
  }

  private normalizeRowColor(raw?: string | null): ApplicationRowColor | null {
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim().toLowerCase();
    if (!trimmed) return null;
    if (!(ALLOWED_ROW_COLORS as readonly string[]).includes(trimmed)) {
      throw new BadRequestException(
        `Noto'g'ri rang qiymati. Ruxsat etilgan ranglar: ${ALLOWED_ROW_COLORS.join(', ')}`,
      );
    }
    return trimmed as ApplicationRowColor;
  }

  private async resolveActorDisplayName(currentUser?: JwtAccessPayload): Promise<string | null> {
    if (!currentUser) return null;
    const user = await this.userRepo.findOne({
      where: { auth_id: currentUser.sub },
      select: { id: true, first_name: true, last_name: true },
    });
    const full = [user?.last_name, user?.first_name].filter(Boolean).join(' ').trim();
    return full || currentUser.username || null;
  }

  async updateRowColor(
    id: string,
    rawColor: string | null | undefined,
    currentUser?: JwtAccessPayload,
  ): Promise<{
    id: string;
    row_color: ApplicationRowColor | null;
    row_color_by: string | null;
    row_color_updated_at: string | null;
  }> {
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException(
        "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
      );
    }

    const color = this.normalizeRowColor(rawColor);

    const app = await this.applicationRepo.findOne({
      where: { id, is_deleted: false },
      select: { id: true, district_id: true },
    });
    if (!app) {
      throw new NotFoundException(`Ariza (ID: ${id}) topilmadi`);
    }

    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const allowedDistrictIds = await getAllowedDistrictIds(this.userRepo, currentUser);
      assertDistrictAccess(
        allowedDistrictIds,
        app.district_id,
        "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalarini belgilashingiz mumkin",
      );
    }

    const actorName = await this.resolveActorDisplayName(currentUser);
    const now = color ? new Date() : null;
    const actorBy = color ? actorName : null;

    await this.applicationRepo.update(id, {
      row_color: color,
      row_color_by: actorBy,
      row_color_updated_at: now,
    });

    const updatedAtIso = now ? now.toISOString() : null;
    this.realtimeService.broadcastRowColorUpdate({
      type: 'row_color_updated',
      items: [
        {
          id: app.id,
          district_id: app.district_id ?? null,
          row_color: color,
          row_color_by: actorBy,
          row_color_updated_at: updatedAtIso,
        },
      ],
      actor_auth_id: currentUser?.sub ?? null,
      actor_name: actorName,
    });

    return {
      id: app.id,
      row_color: color,
      row_color_by: actorBy,
      row_color_updated_at: updatedAtIso,
    };
  }

  async bulkUpdateRowColor(
    ids: string[],
    rawColor: string | null | undefined,
    currentUser?: JwtAccessPayload,
  ): Promise<{
    updatedCount: number;
    items: Array<{
      id: string;
      row_color: ApplicationRowColor | null;
      row_color_by: string | null;
      row_color_updated_at: string | null;
    }>;
  }> {
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException(
        "Rahbar (Boss) hisobi faqat ma'lumotlarni ko'rish (read-only) rejimida ishlaydi",
      );
    }

    const color = this.normalizeRowColor(rawColor);
    const uniqueIds = Array.from(new Set((ids || []).filter((id) => isUUID(id))));
    if (uniqueIds.length === 0) {
      throw new BadRequestException('Kamida bitta ariza tanlanishi shart');
    }

    const apps = await this.applicationRepo.find({
      where: { id: In(uniqueIds), is_deleted: false },
      select: { id: true, district_id: true },
    });

    let targetApps = apps;
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const allowedDistrictIds = (await getAllowedDistrictIds(this.userRepo, currentUser)) ?? [];
      targetApps = apps.filter(
        (a) => a.district_id !== null && allowedDistrictIds.includes(a.district_id),
      );
      if (targetApps.length === 0) {
        throw new ForbiddenException(
          "Siz faqat o'zingizga biriktirilgan tuman(lar) arizalarini belgilashingiz mumkin",
        );
      }
    }

    if (targetApps.length === 0) {
      throw new NotFoundException('Tanlangan arizalar topilmadi');
    }

    const actorName = await this.resolveActorDisplayName(currentUser);
    const now = color ? new Date() : null;
    const actorBy = color ? actorName : null;
    const updatedAtIso = now ? now.toISOString() : null;

    await this.applicationRepo.update(
      { id: In(targetApps.map((a) => a.id)) },
      {
        row_color: color,
        row_color_by: actorBy,
        row_color_updated_at: now,
      },
    );

    this.realtimeService.broadcastRowColorUpdate({
      type: 'row_color_updated',
      items: targetApps.map((app) => ({
        id: app.id,
        district_id: app.district_id ?? null,
        row_color: color,
        row_color_by: actorBy,
        row_color_updated_at: updatedAtIso,
      })),
      actor_auth_id: currentUser?.sub ?? null,
      actor_name: actorName,
    });

    return {
      updatedCount: targetApps.length,
      items: targetApps.map((app) => ({
        id: app.id,
        row_color: color,
        row_color_by: actorBy,
        row_color_updated_at: updatedAtIso,
      })),
    };
  }

  async getStatistics(
    period = 'month',
    startDate?: string,
    endDate?: string,
    currentUser?: JwtAccessPayload,
  ) {
    return this.statisticsService.getStatistics(period, startDate, endDate, currentUser);
  }
}
