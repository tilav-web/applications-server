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
import {
  DetectedCrime,
  type DetectedCrimeMeasure,
  DetectedCrimeQualification,
} from './entities/detected-crime.entity';
import {
  DetectedCrimeEvidence,
  type EvidenceType,
} from './entities/detected-crime-evidence.entity';
import { DetectedCrimeStatus } from './entities/detected-crime-status.entity';
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
  crime_status_id?: string | null;
  status_id?: string | null;
  measures?: DetectedCrimeMeasure[] | null;
  decision_type_id?: string | null;
  decision_number?: string | null;
  decision_date?: string | null;
  decision_note?: string | null;
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
    @InjectRepository(DetectedCrimeStatus)
    private readonly crimeStatusRepo: Repository<DetectedCrimeStatus>,
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
      .leftJoinAndSelect('dc.crime_status', 'cst')
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
      status_name:
        r.detected_crime.crime_status?.name || r.detected_crime.application_status?.name || null,
      status_color:
        r.detected_crime.crime_status?.color ||
        r.detected_crime.application_status?.color ||
        'rose',
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

    let crimeStatusId = dto.crime_status_id || null;
    let crimeStatusObj: DetectedCrimeStatus | null = null;
    if (crimeStatusId) {
      crimeStatusObj = await this.crimeStatusRepo.findOne({ where: { id: crimeStatusId } });
    } else {
      crimeStatusObj = await this.crimeStatusRepo.findOne({
        where: [{ is_default: true }, { code: 'FOSH_ETILDI' }],
        order: { sort_order: 'ASC' },
      });
      crimeStatusId = crimeStatusObj?.id || null;
    }

    const detectedAt = dto.detected_at ? new Date(dto.detected_at) : new Date();
    const caseNumber = dto.case_number?.trim() || (await this.generateCaseNumber());
    const isFinal = Boolean(crimeStatusObj?.is_final);

    const entity = this.repo.create({
      case_number: caseNumber,
      title,
      description: dto.description?.trim() || null,
      report_number: dto.report_number?.trim() || null,
      report_date: dto.report_date ? new Date(dto.report_date) : null,
      kusp_number: dto.kusp_number?.trim() || null,
      detected_at: detectedAt,
      qualification_type: dto.qualification_type || DetectedCrimeQualification.CRIMINAL,
      crime_id: dto.crime_id || null,
      crime_method_id: dto.crime_method_id || null,
      mjtk_article: dto.mjtk_article?.trim() || null,
      detection_source_id: dto.detection_source_id || null,
      district_id: dto.district_id || null,
      department_service_id: dto.department_service_id || null,
      platform: dto.platform?.trim() || null,
      channel_or_source_url: dto.channel_or_source_url?.trim() || null,
      suspect_tree: dto.suspect_tree || [],
      measures: Array.isArray(dto.measures) ? dto.measures : [],
      estimated_damage:
        dto.estimated_damage !== undefined && dto.estimated_damage !== null
          ? Number(dto.estimated_damage)
          : null,
      officer_notes: dto.officer_notes?.trim() || null,
      crime_status_id: crimeStatusId,
      decision_type_id: dto.decision_type_id || null,
      decision_number: dto.decision_number?.trim() || null,
      decision_date: dto.decision_date ? new Date(dto.decision_date) : null,
      decision_note: dto.decision_note?.trim() || null,
      deadline_at: null,
      sla_days: null,
      closed_at: isFinal ? new Date() : null,
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
      crime_status_id?: string;
      status_id?: string;
      qualification_type?: string;
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
      .leftJoinAndSelect('dc.crime_status', 'cst')
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
    const filterStatusId = params.crime_status_id || params.status_id;
    if (filterStatusId) {
      qb.andWhere('dc.crime_status_id = :cstId', { cstId: filterStatusId });
    }
    if (params.qualification_type) {
      qb.andWhere('dc.qualification_type = :qt', { qt: params.qualification_type });
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
        crime_status: true,
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
    delete (item as unknown as Record<string, unknown>).crime_status;
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
    if (fields.measures !== undefined)
      item.measures = Array.isArray(fields.measures) ? fields.measures : [];
    if (fields.estimated_damage !== undefined) {
      item.estimated_damage =
        fields.estimated_damage !== null ? Number(fields.estimated_damage) : null;
    }
    if (fields.officer_notes !== undefined)
      item.officer_notes = fields.officer_notes?.trim() || null;
    if (fields.crime_status_id !== undefined) {
      item.crime_status_id = fields.crime_status_id || null;
      const cst = item.crime_status_id
        ? await this.crimeStatusRepo.findOne({ where: { id: item.crime_status_id } })
        : null;
      item.closed_at = cst?.is_final ? item.closed_at || new Date() : null;
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
      .leftJoin('dc.crime_status', 'cst')
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
      .select(['dc.id', 'dc.qualification_type', 'cst.is_final', 'cst.code'])
      .getMany();

    let criminalCount = 0;
    let adminCount = 0;
    let preInvCount = 0;
    let finalCount = 0;

    for (const r of rows) {
      if (r.qualification_type === DetectedCrimeQualification.CRIMINAL) criminalCount++;
      else if (r.qualification_type === DetectedCrimeQualification.ADMINISTRATIVE) adminCount++;
      else preInvCount++;

      if (r.crime_status?.is_final) {
        finalCount++;
      }
    }

    return {
      total: rows.length,
      criminalCount,
      adminCount,
      preInvCount,
      finalCount,
      inProgressCount: rows.length - finalCount,
      overdueCount: 0,
    };
  }

  async exportExcel(
    params: Parameters<DetectedCrimesService['findAll']>[0],
    res: Response,
    currentUser?: JwtAccessPayload,
  ): Promise<void> {
    const qb = this.repo
      .createQueryBuilder('dc')
      .leftJoinAndSelect('dc.district', 'district')
      .leftJoinAndSelect('dc.crime', 'crime')
      .leftJoinAndSelect('dc.detection_source', 'source')
      .leftJoinAndSelect('dc.department_service', 'dept')
      .leftJoinAndSelect('dc.crime_status', 'cst')
      .leftJoinAndSelect('dc.application_status', 'st')
      .leftJoinAndSelect('dc.decision_type', 'decision')
      .leftJoinAndSelect('dc.suspects', 'suspects')
      .leftJoinAndSelect('suspects.citizen', 'suspect_citizen')
      .leftJoinAndSelect('suspect_citizen.workplace', 'suspect_workplace')
      .leftJoinAndSelect('dc.evidences', 'evidences')
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
    if (params.crime_status_id || params.status_id) {
      qb.andWhere('dc.crime_status_id = :cstId', {
        cstId: params.crime_status_id || params.status_id,
      });
    }
    if (params.qualification_type) {
      qb.andWhere('dc.qualification_type = :qt', { qt: params.qualification_type });
    }

    const items = await qb.orderBy('dc.detected_at', 'DESC').take(2000).getMany();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();

    const styleHeader = (row: ExcelJS.Row) => {
      row.height = 28;
      row.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: '94A3B8' } },
          left: { style: 'thin', color: { argb: 'CBD5E1' } },
          bottom: { style: 'medium', color: { argb: '000000' } },
          right: { style: 'thin', color: { argb: 'CBD5E1' } },
        };
      });
    };

    const styleData = (row: ExcelJS.Row) => {
      row.height = 22;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', size: 9.5, color: { argb: '000000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'E2E8F0' } },
          left: { style: 'thin', color: { argb: 'E2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
          right: { style: 'thin', color: { argb: 'E2E8F0' } },
        };
      });
    };

    const styleTotal = (row: ExcelJS.Row) => {
      row.height = 25;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
        cell.border = {
          top: { style: 'thin', color: { argb: '000000' } },
          bottom: { style: 'double', color: { argb: '000000' } },
          left: { style: 'thin', color: { argb: 'CBD5E1' } },
          right: { style: 'thin', color: { argb: 'CBD5E1' } },
        };
      });
    };

    const qualMap: Record<string, string> = {
      CRIMINAL: 'Jinoyat (JK)',
      ADMINISTRATIVE: 'Ma’muriy (MJTK)',
      PRE_INVESTIGATION: 'Tekshiruvda',
    };

    // 1-SHEET: Aniqlangan jinoyatlar
    const ws1 = workbook.addWorksheet('Aniqlangan jinoyatlar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws1.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ichki kod', key: 'case_number', width: 16 },
      { header: 'Aniqlangan sana', key: 'detected_at', width: 14 },
      { header: 'Sarlavha', key: 'title', width: 34 },
      { header: 'Malaka (JK/MJTK)', key: 'qualification', width: 18 },
      { header: 'Modda', key: 'article', width: 22 },
      { header: 'Hudud (Tuman)', key: 'district', width: 18 },
      { header: 'Aniqlash usuli', key: 'source', width: 26 },
      { header: 'Sohaviy xizmat', key: 'dept', width: 22 },
      { header: 'Platforma / Manzil', key: 'platform', width: 28 },
      { header: 'Bildirgi / KUSP', key: 'report', width: 22 },
      { header: 'Gumonlanuvchilar', key: 'suspects_count', width: 16 },
      { header: 'Ashyoviy dalillar', key: 'evidences_count', width: 16 },
      { header: 'Zarar / Aylanma (UZS)', key: 'damage', width: 22 },
      { header: 'Holati', key: 'status', width: 26 },
      { header: 'Ko‘rilgan choralar', key: 'measures', width: 36 },
      { header: 'Yakuniy qaror / Raqami', key: 'decision', width: 28 },
      { header: 'Fabula', key: 'description', width: 45 },
    ];
    styleHeader(ws1.getRow(1));

    items.forEach((item, idx) => {
      const measuresStr =
        Array.isArray(item.measures) && item.measures.length > 0
          ? item.measures.map((m) => `${m.title}${m.date ? ` (${m.date})` : ''}`).join('; ')
          : '—';
      const decisionStr = item.decision_type?.name
        ? `${item.decision_type.name}${item.decision_number ? ` (№ ${item.decision_number})` : ''}`
        : item.decision_number
          ? `№ ${item.decision_number}`
          : '—';

      const row = ws1.addRow({
        idx: idx + 1,
        case_number: item.case_number || '—',
        detected_at: item.detected_at ? new Date(item.detected_at).toISOString().slice(0, 10) : '—',
        title: item.title,
        qualification: qualMap[item.qualification_type] || item.qualification_type,
        article: item.crime?.article || item.mjtk_article || '—',
        district: item.district?.name || '—',
        source: item.detection_source?.name || '—',
        dept: item.department_service?.short_name || item.department_service?.name || '—',
        platform: [item.platform, item.channel_or_source_url].filter(Boolean).join(' — ') || '—',
        report: [item.report_number, item.kusp_number].filter(Boolean).join(' / ') || '—',
        suspects_count: item.suspects?.length || 0,
        evidences_count: item.evidences?.length || 0,
        damage: Number(item.estimated_damage) || 0,
        status: item.crime_status?.name || item.application_status?.name || 'Fosh etildi',
        measures: measuresStr,
        decision: decisionStr,
        description: item.description || '—',
      });
      styleData(row);
      row.getCell('case_number').numFmt = '@';
      row.getCell('report').numFmt = '@';
      row.getCell('suspects_count').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('evidences_count').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('damage').numFmt = '#,##0.00';
      row.getCell('damage').alignment = { horizontal: 'right', vertical: 'middle' };
    });

    const lastRow1 = ws1.rowCount;
    if (lastRow1 >= 2) {
      const totalRow = ws1.addRow({
        report: 'JAMI:',
        suspects_count: { formula: `SUM(L2:L${lastRow1})` },
        evidences_count: { formula: `SUM(M2:M${lastRow1})` },
        damage: { formula: `SUM(N2:N${lastRow1})` },
      });
      styleTotal(totalRow);
      totalRow.getCell('report').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('suspects_count').alignment = { horizontal: 'center', vertical: 'middle' };
      totalRow.getCell('evidences_count').alignment = { horizontal: 'center', vertical: 'middle' };
      totalRow.getCell('damage').numFmt = '#,##0.00';
      totalRow.getCell('damage').alignment = { horizontal: 'right', vertical: 'middle' };
    }

    // 2-SHEET: Gumonlanuvchilar
    const ws2 = workbook.addWorksheet('Gumonlanuvchilar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws2.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ish kodi', key: 'case_number', width: 16 },
      { header: 'F.I.O.', key: 'name', width: 28 },
      { header: 'Pasport', key: 'passport', width: 16 },
      { header: 'Telefon', key: 'phone', width: 18 },
      { header: 'Ish joyi', key: 'workplace', width: 26 },
      { header: 'Jinoyatdagi roli', key: 'role', width: 18 },
      { header: 'Ehtiyot chorasi', key: 'detention', width: 18 },
      { header: 'Takroriy shaxs', key: 'repeat', width: 16 },
      { header: 'Izoh', key: 'notes', width: 32 },
    ];
    styleHeader(ws2.getRow(1));

    let sIdx = 0;
    for (const item of items) {
      for (const s of item.suspects || []) {
        sIdx++;
        const fullName = s.citizen
          ? [s.citizen.last_name, s.citizen.first_name, s.citizen.middle_name]
              .filter(Boolean)
              .join(' ')
          : '—';
        const row = ws2.addRow({
          idx: sIdx,
          case_number: item.case_number || '—',
          name: fullName,
          passport: s.citizen?.passport || '—',
          phone: s.citizen?.phone_number || '—',
          workplace: s.citizen?.workplace?.name || '—',
          role: s.role_in_crime,
          detention: s.detention_status,
          repeat: s.is_repeat_offender ? 'Ha (Takroriy)' : 'Yo‘q',
          notes: s.notes || '—',
        });
        styleData(row);
        row.getCell('case_number').numFmt = '@';
        row.getCell('passport').numFmt = '@';
        row.getCell('phone').numFmt = '@';
      }
    }

    // 3-SHEET: Ashyoviy dalillar
    const ws3 = workbook.addWorksheet('Ashyoviy dalillar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws3.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ish kodi', key: 'case_number', width: 16 },
      { header: 'Dalil turi', key: 'type', width: 22 },
      { header: 'Nomi', key: 'title', width: 30 },
      { header: 'IMEI / Identifikator', key: 'identifier', width: 26 },
      { header: 'Biriktirilgan fayl', key: 'file_name', width: 26 },
      { header: 'Izoh', key: 'notes', width: 32 },
    ];
    styleHeader(ws3.getRow(1));

    let eIdx = 0;
    for (const item of items) {
      for (const ev of item.evidences || []) {
        eIdx++;
        const row = ws3.addRow({
          idx: eIdx,
          case_number: item.case_number || '—',
          type: ev.evidence_type,
          title: ev.title,
          identifier: ev.identifier_value || '—',
          file_name: ev.file_name || '—',
          notes: ev.notes || '—',
        });
        styleData(row);
        row.getCell('case_number').numFmt = '@';
        row.getCell('identifier').numFmt = '@';
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Aniqlangan_Jinoyatlar_${dateStr}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  }
}
