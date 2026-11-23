import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { PaginatedResult } from '../../common/interfaces/pagination.interface';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import type { SuspectTreeNode } from '../applications/application.entity';
import { Citizen } from '../applications/citizens/citizen.entity';
import {
  ApplicationStatus,
  ApplicationStatusCategory,
} from '../applications/statuses/application-status.entity';
import { User } from '../users/user.entity';
import { DetectedCrime, DetectedCrimeQualification } from './entities/detected-crime.entity';
import {
  DetectedCrimeEvidence,
  type EvidenceType,
} from './entities/detected-crime-evidence.entity';
import {
  DetectedCrimeSuspect,
  type DetentionStatus,
  type SuspectCrimeRole,
} from './entities/detected-crime-suspect.entity';

export interface SaveDetectedCrimeInput {
  case_number?: string | null;
  title: string;
  description?: string | null;
  report_number?: string | null;
  report_date?: string | null;
  kusp_number?: string | null;
  detected_at?: string | null;
  qualification_type?: DetectedCrimeQualification;
  crime_id?: string | null;
  crime_method_id?: string | null;
  mjtk_article?: string | null;
  detection_source_id?: string | null;
  district_id?: string | null;
  department_service_id?: string | null;
  platform?: string | null;
  channel_or_source_url?: string | null;
  suspect_tree?: SuspectTreeNode[] | null;
  estimated_damage?: number | null;
  officer_notes?: string | null;
  status_id?: string | null;
  decision_type_id?: string | null;
  decision_number?: string | null;
  decision_date?: string | null;
  decision_note?: string | null;
  sla_days?: number | null;
  deadline_at?: string | null;
  suspects?: Array<{
    citizen_id: string;
    role_in_crime?: SuspectCrimeRole;
    detention_status?: DetentionStatus;
    is_repeat_offender?: boolean;
    notes?: string | null;
  }>;
  evidences?: Array<{
    evidence_type?: EvidenceType;
    title: string;
    identifier_value?: string | null;
    seized_at?: string | null;
    seized_from_citizen_id?: string | null;
    file_key?: string | null;
    file_name?: string | null;
    notes?: string | null;
  }>;
}

@Injectable()
export class DetectedCrimesService {
  constructor(
    @InjectRepository(DetectedCrime)
    private readonly repo: Repository<DetectedCrime>,
    @InjectRepository(DetectedCrimeSuspect)
    private readonly suspectRepo: Repository<DetectedCrimeSuspect>,
    @InjectRepository(DetectedCrimeEvidence)
    private readonly evidenceRepo: Repository<DetectedCrimeEvidence>,
    @InjectRepository(ApplicationStatus)
    private readonly statusRepo: Repository<ApplicationStatus>,
    @InjectRepository(Citizen)
    private readonly citizenRepo: Repository<Citizen>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private async getUserWithDistricts(currentUser?: JwtAccessPayload): Promise<User | null> {
    if (!currentUser) return null;
    return this.userRepo.findOne({
      where: { auth_id: currentUser.sub },
      relations: { assigned_districts: true },
    });
  }

  private async generateCaseNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.repo
      .createQueryBuilder('dc')
      .where('EXTRACT(YEAR FROM dc.created_at) = :year', { year })
      .getCount();
    const seq = String(count + 1).padStart(4, '0');
    return `AJ-${year}-${seq}`;
  }

  /**
   * Fuqaro oldin boshqa aniqlangan jinoyat/MJTK da qayd etilganini tekshiradi
   */
  async checkCitizenRepeatHistory(citizenId: string, excludeCrimeId?: string) {
    const qb = this.suspectRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.detected_crime', 'dc')
      .leftJoinAndSelect('dc.crime', 'crime')
      .where('s.citizen_id = :citizenId', { citizenId })
      .andWhere('dc.is_deleted = false');

    if (excludeCrimeId) {
      qb.andWhere('dc.id != :excludeCrimeId', { excludeCrimeId });
    }

    const priors = await qb.orderBy('dc.detected_at', 'DESC').getMany();
    return {
      isRepeat: priors.length > 0,
      count: priors.length,
      items: priors.map((p) => ({
        id: p.detected_crime.id,
        case_number: p.detected_crime.case_number,
        title: p.detected_crime.title,
        qualification_type: p.detected_crime.qualification_type,
        article: p.detected_crime.crime?.article || p.detected_crime.mjtk_article || null,
        detected_at: p.detected_crime.detected_at,
        role_in_crime: p.role_in_crime,
      })),
    };
  }

  async findByCitizenId(citizenId: string) {
    const rows = await this.suspectRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.detected_crime', 'dc')
      .leftJoinAndSelect('dc.crime', 'crime')
      .leftJoinAndSelect('dc.district', 'district')
      .leftJoinAndSelect('dc.application_status', 'st')
      .leftJoinAndSelect('dc.detection_source', 'src')
      .where('s.citizen_id = :citizenId', { citizenId })
      .andWhere('dc.is_deleted = false')
      .orderBy('dc.detected_at', 'DESC')
      .getMany();

    return rows.map((r) => ({
      id: r.detected_crime.id,
      case_number: r.detected_crime.case_number,
      title: r.detected_crime.title,
      qualification_type: r.detected_crime.qualification_type,
      crime_article: r.detected_crime.crime?.article || null,
      mjtk_article: r.detected_crime.mjtk_article || null,
      district_name: r.detected_crime.district?.name || null,
      source_name: r.detected_crime.detection_source?.name || null,
      status_name: r.detected_crime.application_status?.name || null,
      status_color: r.detected_crime.application_status?.color || 'blue',
      role_in_crime: r.role_in_crime,
      detention_status: r.detention_status,
      detected_at: r.detected_crime.detected_at,
    }));
  }

  async create(
    dto: SaveDetectedCrimeInput,
    currentUser?: JwtAccessPayload,
  ): Promise<DetectedCrime> {
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException("Rahbar (Boss) hisobi faqat ko'rish rejimida ishlaydi");
    }

    const title = (dto.title || '').trim();
    if (!title) throw new BadRequestException('Aniqlangan jinoyat sarlavhasi kiritilishi shart');

    const user = await this.getUserWithDistricts(currentUser);
    if (currentUser?.role === Role.DISTRICT_OFFICER) {
      const assigned = user?.assigned_districts?.map((d) => d.id) || [];
      if (dto.district_id && !assigned.includes(dto.district_id)) {
        throw new ForbiddenException(
          "Siz faqat o'zingizga biriktirilgan tuman(lar) bo'yicha ma'lumot kirita olasiz",
        );
      }
    }

    let statusId = dto.status_id || null;
    let statusObj: ApplicationStatus | null = null;
    if (statusId) {
      statusObj = await this.statusRepo.findOne({ where: { id: statusId } });
    } else {
      statusObj = await this.statusRepo.findOne({
        where: [{ is_default: true }, { code: 'YANGI' }],
        order: { sort_order: 'ASC' },
      });
      statusId = statusObj?.id || null;
    }

    const detectedAt = dto.detected_at ? new Date(dto.detected_at) : new Date();
    const slaDays = dto.sla_days ?? statusObj?.default_sla_days ?? 10;
    const deadlineAt = dto.deadline_at
      ? new Date(dto.deadline_at)
      : !statusObj || statusObj.tracks_sla
        ? new Date(detectedAt.getTime() + slaDays * 24 * 60 * 60 * 1000)
        : null;

    const caseNumber = dto.case_number?.trim() || (await this.generateCaseNumber());
    const isClosed = statusObj?.category === ApplicationStatusCategory.CLOSED;

    const entity = this.repo.create({
      case_number: caseNumber,
      title,
      description: dto.description?.trim() || null,
      report_number: dto.report_number?.trim() || null,
      report_date: dto.report_date ? new Date(dto.report_date) : null,
      kusp_number: dto.kusp_number?.trim() || null,
      detected_at: detectedAt,
      qualification_type: dto.qualification_type || DetectedCrimeQualification.PRE_INVESTIGATION,
      crime_id: dto.crime_id || null,
      crime_method_id: dto.crime_method_id || null,
      mjtk_article: dto.mjtk_article?.trim() || null,
      detection_source_id: dto.detection_source_id || null,
      district_id: dto.district_id || null,
      department_service_id: dto.department_service_id || null,
      platform: dto.platform?.trim() || null,
      channel_or_source_url: dto.channel_or_source_url?.trim() || null,
      suspect_tree: dto.suspect_tree || [],
      estimated_damage:
        dto.estimated_damage !== undefined && dto.estimated_damage !== null
          ? Number(dto.estimated_damage)
          : null,
      officer_notes: dto.officer_notes?.trim() || null,
      status_id: statusId,
      decision_type_id: dto.decision_type_id || null,
      decision_number: dto.decision_number?.trim() || null,
      decision_date: dto.decision_date ? new Date(dto.decision_date) : null,
      decision_note: dto.decision_note?.trim() || null,
      sla_days: slaDays,
      deadline_at: deadlineAt,
      closed_at: isClosed ? new Date() : null,
      detected_by_id: user?.id || null,
      created_by_id: user?.id || null,
      is_deleted: false,
    });

    const saved = await this.repo.save(entity);

    if (Array.isArray(dto.suspects) && dto.suspects.length > 0) {
      await this.syncSuspects(saved.id, dto.suspects);
    }

    if (Array.isArray(dto.evidences) && dto.evidences.length > 0) {
      await this.syncEvidences(saved.id, dto.evidences);
    }

    return this.findOne(saved.id, currentUser);
  }

  private async syncSuspects(
    crimeId: string,
    suspects: NonNullable<SaveDetectedCrimeInput['suspects']>,
  ): Promise<void> {
    await this.suspectRepo.delete({ detected_crime_id: crimeId });
    const seen = new Set<string>();
    const rows: DetectedCrimeSuspect[] = [];
    for (const s of suspects) {
      if (!s.citizen_id || seen.has(s.citizen_id)) continue;
      seen.add(s.citizen_id);
      const prior = await this.checkCitizenRepeatHistory(s.citizen_id, crimeId);
      rows.push(
        this.suspectRepo.create({
          detected_crime_id: crimeId,
          citizen_id: s.citizen_id,
          role_in_crime: s.role_in_crime || 'IJROCHI',
          detention_status: s.detention_status || 'ANIQLANMOQDA',
          is_repeat_offender: s.is_repeat_offender ?? prior.isRepeat,
          notes: s.notes?.trim() || null,
        }),
      );
    }
    if (rows.length > 0) {
      await this.suspectRepo.save(rows);
    }
  }

  private async syncEvidences(
    crimeId: string,
    evidences: NonNullable<SaveDetectedCrimeInput['evidences']>,
  ): Promise<void> {
    await this.evidenceRepo.delete({ detected_crime_id: crimeId });
    const rows: DetectedCrimeEvidence[] = [];
    for (const e of evidences) {
      if (!e.title?.trim()) continue;
      rows.push(
        this.evidenceRepo.create({
          detected_crime_id: crimeId,
          evidence_type: e.evidence_type || 'OTHER',
          title: e.title.trim(),
          identifier_value: e.identifier_value?.trim() || null,
          seized_at: e.seized_at ? new Date(e.seized_at) : null,
          seized_from_citizen_id: e.seized_from_citizen_id || null,
          file_key: e.file_key || null,
          file_name: e.file_name || null,
          notes: e.notes?.trim() || null,
        }),
      );
    }
    if (rows.length > 0) {
      await this.evidenceRepo.save(rows);
    }
  }

  async findAll(
    params: {
      page?: number;
      limit?: number;
      search?: string;
      district_id?: string;
      crime_id?: string;
      detection_source_id?: string;
      status_id?: string;
      qualification_type?: string;
      sla_filter?: string;
    },
    currentUser?: JwtAccessPayload,
  ): Promise<PaginatedResult<DetectedCrime>> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 15));
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('dc')
      .leftJoinAndSelect('dc.district', 'district')
      .leftJoinAndSelect('dc.crime', 'crime')
      .leftJoinAndSelect('dc.detection_source', 'source')
      .leftJoinAndSelect('dc.application_status', 'st')
      .leftJoinAndSelect('dc.suspects', 'suspects')
      .leftJoinAndSelect('suspects.citizen', 'suspect_citizen')
      .where('dc.is_deleted = false');

    if (currentUser?.role === Role.DISTRICT_OFFICER) {
      const user = await this.getUserWithDistricts(currentUser);
      const assigned = user?.assigned_districts?.map((d) => d.id) || [];
      if (assigned.length > 0) {
        qb.andWhere('dc.district_id IN (:...assigned)', { assigned });
      } else {
        qb.andWhere('1 = 0');
      }
    }

    if (params.search?.trim()) {
      const q = `%${params.search.trim()}%`;
      qb.andWhere(
        '(dc.case_number ILIKE :q OR dc.title ILIKE :q OR dc.description ILIKE :q OR dc.report_number ILIKE :q OR dc.kusp_number ILIKE :q OR dc.platform ILIKE :q OR dc.channel_or_source_url ILIKE :q OR dc.mjtk_article ILIKE :q)',
        { q },
      );
    }

    if (params.district_id) qb.andWhere('dc.district_id = :dId', { dId: params.district_id });
    if (params.crime_id) qb.andWhere('dc.crime_id = :cId', { cId: params.crime_id });
    if (params.detection_source_id) {
      qb.andWhere('dc.detection_source_id = :srcId', { srcId: params.detection_source_id });
    }
    if (params.status_id) qb.andWhere('dc.status_id = :stId', { stId: params.status_id });
    if (params.qualification_type) {
      qb.andWhere('dc.qualification_type = :qt', { qt: params.qualification_type });
    }

    if (params.sla_filter) {
      const now = new Date();
      if (params.sla_filter === 'overdue') {
        qb.andWhere('(st.tracks_sla = true OR st.id IS NULL) AND dc.deadline_at < :now', { now });
      } else if (params.sla_filter === 'due_72h') {
        const in72h = new Date(now.getTime() + 72 * 3600 * 1000);
        qb.andWhere(
          '(st.tracks_sla = true OR st.id IS NULL) AND dc.deadline_at >= :now AND dc.deadline_at <= :in72h',
          { now, in72h },
        );
      } else if (params.sla_filter === 'extended') {
        qb.andWhere("dc.extended_until IS NOT NULL OR st.category = 'EXTENDED'");
      }
    }

    qb.orderBy('dc.detected_at', 'DESC').skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();
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

  async findOne(id: string, currentUser?: JwtAccessPayload): Promise<DetectedCrime> {
    const item = await this.repo.findOne({
      where: { id, is_deleted: false },
      relations: {
        district: true,
        crime: true,
        crime_method: true,
        detection_source: true,
        department_service: true,
        application_status: true,
        decision_type: true,
        detected_by: true,
        created_by: true,
        suspects: { citizen: { district: true, workplace: true } },
        evidences: { seized_from_citizen: true },
      },
    });
    if (!item) throw new NotFoundException(`Aniqlangan jinoyat (ID: ${id}) topilmadi`);

    if (currentUser?.role === Role.DISTRICT_OFFICER) {
      const user = await this.getUserWithDistricts(currentUser);
      const assigned = user?.assigned_districts?.map((d) => d.id) || [];
      if (item.district_id && !assigned.includes(item.district_id)) {
        throw new ForbiddenException(
          "Siz faqat o'zingizga biriktirilgan tuman(lar) ma'lumotlarini ko'ra olasiz",
        );
      }
    }
    return item;
  }

  async update(
    id: string,
    dto: Partial<SaveDetectedCrimeInput>,
    currentUser?: JwtAccessPayload,
  ): Promise<DetectedCrime> {
    const item = await this.findOne(id, currentUser);
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException("Rahbar (Boss) hisobi faqat ko'rish rejimida ishlaydi");
    }

    const { suspects, evidences, ...fields } = dto;

    // Stale relationlarni tozalash
    delete (item as unknown as Record<string, unknown>).district;
    delete (item as unknown as Record<string, unknown>).crime;
    delete (item as unknown as Record<string, unknown>).crime_method;
    delete (item as unknown as Record<string, unknown>).detection_source;
    delete (item as unknown as Record<string, unknown>).department_service;
    delete (item as unknown as Record<string, unknown>).application_status;
    delete (item as unknown as Record<string, unknown>).decision_type;
    delete (item as unknown as Record<string, unknown>).suspects;
    delete (item as unknown as Record<string, unknown>).evidences;

    if (fields.title !== undefined) item.title = fields.title.trim();
    if (fields.case_number !== undefined) item.case_number = fields.case_number?.trim() || null;
    if (fields.description !== undefined) item.description = fields.description?.trim() || null;
    if (fields.report_number !== undefined)
      item.report_number = fields.report_number?.trim() || null;
    if (fields.report_date !== undefined) {
      item.report_date = fields.report_date ? new Date(fields.report_date) : null;
    }
    if (fields.kusp_number !== undefined) item.kusp_number = fields.kusp_number?.trim() || null;
    if (fields.detected_at !== undefined && fields.detected_at) {
      item.detected_at = new Date(fields.detected_at);
    }
    if (fields.qualification_type !== undefined)
      item.qualification_type = fields.qualification_type;
    if (fields.crime_id !== undefined) item.crime_id = fields.crime_id || null;
    if (fields.crime_method_id !== undefined) item.crime_method_id = fields.crime_method_id || null;
    if (fields.mjtk_article !== undefined) item.mjtk_article = fields.mjtk_article?.trim() || null;
    if (fields.detection_source_id !== undefined) {
      item.detection_source_id = fields.detection_source_id || null;
    }
    if (fields.district_id !== undefined) item.district_id = fields.district_id || null;
    if (fields.department_service_id !== undefined) {
      item.department_service_id = fields.department_service_id || null;
    }
    if (fields.platform !== undefined) item.platform = fields.platform?.trim() || null;
    if (fields.channel_or_source_url !== undefined) {
      item.channel_or_source_url = fields.channel_or_source_url?.trim() || null;
    }
    if (fields.suspect_tree !== undefined) item.suspect_tree = fields.suspect_tree || [];
    if (fields.estimated_damage !== undefined) {
      item.estimated_damage =
        fields.estimated_damage !== null ? Number(fields.estimated_damage) : null;
    }
    if (fields.officer_notes !== undefined)
      item.officer_notes = fields.officer_notes?.trim() || null;
    if (fields.status_id !== undefined) {
      item.status_id = fields.status_id || null;
      const st = item.status_id
        ? await this.statusRepo.findOne({ where: { id: item.status_id } })
        : null;
      if (st?.category === ApplicationStatusCategory.CLOSED) {
        item.closed_at = item.closed_at || new Date();
      } else {
        item.closed_at = null;
      }
    }
    if (fields.decision_type_id !== undefined)
      item.decision_type_id = fields.decision_type_id || null;
    if (fields.decision_number !== undefined) {
      item.decision_number = fields.decision_number?.trim() || null;
    }
    if (fields.decision_date !== undefined) {
      item.decision_date = fields.decision_date ? new Date(fields.decision_date) : null;
    }
    if (fields.decision_note !== undefined)
      item.decision_note = fields.decision_note?.trim() || null;
    if (fields.deadline_at !== undefined) {
      item.deadline_at = fields.deadline_at ? new Date(fields.deadline_at) : null;
    }

    await this.repo.save(item);

    if (suspects !== undefined) {
      await this.syncSuspects(id, suspects);
    }
    if (evidences !== undefined) {
      await this.syncEvidences(id, evidences);
    }

    return this.findOne(id, currentUser);
  }

  async extendDeadline(
    id: string,
    dto: { extend_days?: number; reason: string; prosecutor_approval_number?: string },
    currentUser?: JwtAccessPayload,
  ): Promise<DetectedCrime> {
    const item = await this.findOne(id, currentUser);
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException("Rahbar (Boss) hisobi faqat ko'rish rejimida ishlaydi");
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Uzaytirish sababi kiritilishi shart');
    }

    const base = item.detected_at || item.created_at || new Date();
    const days = Math.max(1, Math.min(365, Number(dto.extend_days) || 30));
    const newDeadline = new Date(new Date(base).getTime() + days * 24 * 60 * 60 * 1000);

    const extStatus = await this.statusRepo.findOne({
      where: [{ code: 'MUDDATI_UZAYTIRILGAN' }, { category: ApplicationStatusCategory.EXTENDED }],
    });

    await this.repo.update(id, {
      deadline_at: newDeadline,
      extended_until: newDeadline,
      sla_days: days,
      extension_reason: dto.reason.trim(),
      prosecutor_approval_number: dto.prosecutor_approval_number?.trim() || null,
      ...(extStatus ? { status_id: extStatus.id } : {}),
    });

    return this.findOne(id, currentUser);
  }

  async remove(id: string, currentUser?: JwtAccessPayload) {
    const item = await this.findOne(id, currentUser);
    if (currentUser?.role === Role.BOSS) {
      throw new ForbiddenException("Rahbar (Boss) hisobi faqat ko'rish rejimida ishlaydi");
    }
    await this.repo.update(item.id, {
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by_id: currentUser?.sub || null,
    });
    return { success: true, message: "Aniqlangan jinoyat o'chirildi" };
  }

  async getStats(currentUser?: JwtAccessPayload) {
    const qb = this.repo
      .createQueryBuilder('dc')
      .leftJoin('dc.application_status', 'st')
      .where('dc.is_deleted = false');

    if (currentUser?.role === Role.DISTRICT_OFFICER) {
      const user = await this.getUserWithDistricts(currentUser);
      const assigned = user?.assigned_districts?.map((d) => d.id) || [];
      if (assigned.length > 0) {
        qb.andWhere('dc.district_id IN (:...assigned)', { assigned });
      } else {
        qb.andWhere('1 = 0');
      }
    }

    const rows = await qb
      .select(['dc.id', 'dc.qualification_type', 'dc.deadline_at', 'st.tracks_sla', 'st.category'])
      .getMany();

    const nowMs = Date.now();
    let criminalCount = 0;
    let adminCount = 0;
    let preInvCount = 0;
    let overdueCount = 0;

    for (const r of rows) {
      if (r.qualification_type === DetectedCrimeQualification.CRIMINAL) criminalCount++;
      else if (r.qualification_type === DetectedCrimeQualification.ADMINISTRATIVE) adminCount++;
      else preInvCount++;

      const tracks = r.application_status ? r.application_status.tracks_sla : true;
      if (tracks && r.deadline_at && new Date(r.deadline_at).getTime() < nowMs) {
        overdueCount++;
      }
    }

    return {
      total: rows.length,
      criminalCount,
      adminCount,
      preInvCount,
      overdueCount,
    };
  }

  async exportExcel(
    params: Parameters<DetectedCrimesService['findAll']>[0],
    res: Response,
    currentUser?: JwtAccessPayload,
  ): Promise<void> {
    const result = await this.findAll({ ...params, page: 1, limit: 1000 }, currentUser);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Aniqlangan jinoyatlar');

    sheet.columns = [
      { header: '№ / Kod', key: 'case_number', width: 16 },
      { header: 'Aniqlangan sana', key: 'detected_at', width: 15 },
      { header: 'Sarlavha', key: 'title', width: 32 },
      { header: 'Malaka (JK/MJTK)', key: 'qualification', width: 18 },
      { header: 'Modda', key: 'article', width: 20 },
      { header: 'Hudud', key: 'district', width: 18 },
      { header: 'Aniqlash usuli', key: 'source', width: 24 },
      { header: 'Platforma / Kanal', key: 'platform', width: 24 },
      { header: 'Gumonlanuvchilar', key: 'suspects', width: 30 },
      { header: 'Bildirgi / KUSP', key: 'report', width: 20 },
      { header: 'Holati', key: 'status', width: 22 },
    ];

    const qualMap: Record<string, string> = {
      CRIMINAL: 'Jinoyat (JK)',
      ADMINISTRATIVE: 'Ma’muriy (MJTK)',
      PRE_INVESTIGATION: 'Tekshiruvda',
    };

    for (const item of result.items) {
      const suspectNames = (item.suspects || [])
        .map((s) =>
          s.citizen ? `${s.citizen.last_name || ''} ${s.citizen.first_name || ''}`.trim() : '',
        )
        .filter(Boolean)
        .join(', ');

      sheet.addRow({
        case_number: item.case_number || '—',
        detected_at: item.detected_at
          ? new Date(item.detected_at).toLocaleDateString('uz-UZ')
          : '—',
        title: item.title,
        qualification: qualMap[item.qualification_type] || item.qualification_type,
        article: item.crime?.article || item.mjtk_article || '—',
        district: item.district?.name || '—',
        source: item.detection_source?.name || '—',
        platform: [item.platform, item.channel_or_source_url].filter(Boolean).join(' — ') || '—',
        suspects: suspectNames || 'Aniqlanmoqda',
        report: [item.report_number, item.kusp_number].filter(Boolean).join(' / ') || '—',
        status: item.application_status?.name || '—',
      });
    }

    sheet.getRow(1).font = { bold: true };
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="aniqlangan_jinoyatlar.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  }
}
