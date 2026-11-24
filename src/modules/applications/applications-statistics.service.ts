import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ApplicationStatus } from '../../common/enums/application-status.enum';
import { Role } from '../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { User } from '../users/user.entity';
import { Application } from './application.entity';
import { District } from './districts/district.entity';
import { ApplicationStatusCategory } from './statuses/application-status.entity';
import { Transfer } from './transfers/transfer.entity';

@Injectable()
export class ApplicationsStatisticsService {
  constructor(
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getSlaOverview(currentUser?: JwtAccessPayload) {
    let assignedDistrictIds: string[] | null = null;
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      assignedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
      if (assignedDistrictIds.length === 0) {
        return {
          totalActive: 0,
          overdueCount: 0,
          due24hCount: 0,
          due72hCount: 0,
          extendedCount: 0,
          onTrackCount: 0,
          urgentItems: [],
        };
      }
    }

    const now = new Date();
    const nowMs = now.getTime();
    const cutoff24h = new Date(nowMs + 24 * 60 * 60 * 1000);
    const cutoff72h = new Date(nowMs + 72 * 60 * 60 * 1000);

    const aggQb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoin('app.application_status', 'st')
      .where('app.is_deleted = false')
      .andWhere('app.closed_at IS NULL')
      .andWhere('app.deadline_at IS NOT NULL')
      .andWhere('(st.tracks_sla = true OR st.id IS NULL)')
      .select('COUNT(app.id)::int', 'totalActive')
      .addSelect(`COUNT(app.id) FILTER (WHERE app.deadline_at < :now)::int`, 'overdueCount')
      .addSelect(
        `COUNT(app.id) FILTER (WHERE app.deadline_at >= :now AND app.deadline_at <= :cutoff24h)::int`,
        'due24hCount',
      )
      .addSelect(
        `COUNT(app.id) FILTER (WHERE app.deadline_at > :cutoff24h AND app.deadline_at <= :cutoff72h)::int`,
        'due72hCount',
      )
      .addSelect(`COUNT(app.id) FILTER (WHERE app.deadline_at > :cutoff72h)::int`, 'onTrackCount')
      .addSelect(
        `COUNT(app.id) FILTER (WHERE app.extended_until IS NOT NULL OR st.category = :extCat)::int`,
        'extendedCount',
      )
      .setParameters({
        now,
        cutoff24h,
        cutoff72h,
        extCat: ApplicationStatusCategory.EXTENDED,
      });

    const urgentQb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.application_status', 'st')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .where('app.is_deleted = false')
      .andWhere('app.closed_at IS NULL')
      .andWhere('app.deadline_at IS NOT NULL')
      .andWhere('app.deadline_at <= :cutoff72h', { cutoff72h })
      .andWhere('(st.tracks_sla = true OR st.id IS NULL)')
      .orderBy('app.deadline_at', 'ASC')
      .take(10);

    if (assignedDistrictIds !== null) {
      aggQb.andWhere('app.district_id IN (:...userDistricts)', {
        userDistricts: assignedDistrictIds,
      });
      urgentQb.andWhere('app.district_id IN (:...userDistricts)', {
        userDistricts: assignedDistrictIds,
      });
    }

    const [aggRaw, urgentApps] = await Promise.all([
      aggQb.getRawOne<{
        totalActive?: string | number;
        overdueCount?: string | number;
        due24hCount?: string | number;
        due72hCount?: string | number;
        extendedCount?: string | number;
        onTrackCount?: string | number;
      }>(),
      urgentQb.getMany(),
    ]);

    const urgentItems = urgentApps.map((a) => ({
      id: a.id,
      application_number: a.application_number,
      deadline_at: a.deadline_at,
      sla_days: a.sla_days,
      extended_until: a.extended_until,
      district_name: a.district?.name || null,
      citizen_name: a.citizen
        ? `${a.citizen.last_name || ''} ${a.citizen.first_name || ''}`.trim()
        : null,
      status_name: a.application_status?.name || a.status,
      status_color: a.application_status?.color || 'blue',
      hours_remaining: Math.round((new Date(a.deadline_at!).getTime() - nowMs) / (60 * 60 * 1000)),
    }));

    return {
      totalActive: Number(aggRaw?.totalActive || 0),
      overdueCount: Number(aggRaw?.overdueCount || 0),
      due24hCount: Number(aggRaw?.due24hCount || 0),
      due72hCount: Number(aggRaw?.due72hCount || 0),
      extendedCount: Number(aggRaw?.extendedCount || 0),
      onTrackCount: Number(aggRaw?.onTrackCount || 0),
      urgentItems,
    };
  }

  async getStatistics(
    period = 'month',
    startDate?: string,
    endDate?: string,
    currentUser?: JwtAccessPayload,
  ) {
    const now = new Date();
    let start: Date;
    let end: Date = new Date();

    if (period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (period === 'week') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    } else if (period === 'custom' && startDate) {
      start = new Date(startDate);
      if (Number.isNaN(start.getTime())) {
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      start.setHours(0, 0, 0, 0);
      if (endDate) {
        const parsedEnd = new Date(endDate);
        if (!Number.isNaN(parsedEnd.getTime())) {
          end = parsedEnd;
          end.setHours(23, 59, 59, 999);
        }
      }
      const maxSpanMs = 5 * 366 * 24 * 60 * 60 * 1000;
      if (end.getTime() < start.getTime()) {
        const tmp = start;
        start = new Date(end);
        start.setHours(0, 0, 0, 0);
        end = tmp;
        end.setHours(23, 59, 59, 999);
      }
      if (end.getTime() - start.getTime() > maxSpanMs) {
        start = new Date(end.getTime() - maxSpanMs);
        start.setHours(0, 0, 0, 0);
      }
    } else if (period === 'all') {
      start = new Date(2020, 0, 1, 0, 0, 0, 0);
    } else {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    }

    const durationMs = Math.max(end.getTime() - start.getTime(), 1000);
    const prevStart = new Date(start.getTime() - durationMs);
    const prevEnd = new Date(start.getTime() - 1);

    let assignedDistrictIds: string[] | null = null;
    if (currentUser && currentUser.role === Role.DISTRICT_OFFICER) {
      const user = await this.userRepo.findOne({
        where: { auth_id: currentUser.sub },
        relations: { assigned_districts: true },
      });
      assignedDistrictIds = user?.assigned_districts?.map((d) => d.id) || [];
    }

    const appsQb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.application_status', 'application_status')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .leftJoinAndSelect('citizen.neighborhood', 'citizen_neighborhood')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.crime', 'crime')
      .leftJoinAndSelect('transfer.payment_provider', 'payment_provider')
      .leftJoinAndSelect('app.custom_fields', 'custom_fields')
      .where('app.is_deleted = false')
      .andWhere('COALESCE(app.date, app.created_at) BETWEEN :start AND :end', { start, end });

    if (assignedDistrictIds !== null) {
      if (assignedDistrictIds.length > 0) {
        appsQb.andWhere('app.district_id IN (:...userDistricts)', {
          userDistricts: assignedDistrictIds,
        });
      } else {
        appsQb.andWhere('1 = 0');
      }
    }

    const applications = await appsQb
      .orderBy('COALESCE(app.date, app.created_at)', 'ASC')
      .getMany();

    const appIds = applications.map((a) => a.id);
    const extraTransfersByApp = new Map<string, Transfer[]>();
    if (appIds.length > 0) {
      const extraTransfers = await this.transferRepo.find({
        where: { application_id: In(appIds) },
        relations: { payment_provider: true },
      });
      for (const tr of extraTransfers) {
        if (!tr.application_id) continue;
        const arr = extraTransfersByApp.get(tr.application_id) || [];
        arr.push(tr);
        extraTransfersByApp.set(tr.application_id, arr);
      }
    }

    const getAppTransfers = (app: Application): Transfer[] => {
      const byId = new Map<string, Transfer>();
      if (app.transfer) byId.set(app.transfer.id, app.transfer);
      for (const tr of extraTransfersByApp.get(app.id) || []) {
        if (!byId.has(tr.id)) byId.set(tr.id, tr);
      }
      return Array.from(byId.values());
    };

    const getAppTotalLoss = (app: Application): number => {
      const list = getAppTransfers(app);
      let sum = 0;
      for (const tr of list) {
        if (!tr.currency || tr.currency.toUpperCase() === 'UZS') {
          sum += Number(tr.amount || 0);
        }
      }
      return sum;
    };

    const classifyAppBucket = (
      app: Application,
    ): 'NEW' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED' => {
      const code = (app.application_status?.code || app.status || '').toUpperCase();
      const cat = String(app.application_status?.category || '').toUpperCase();
      if (code === String(ApplicationStatus.RAD_ETILDI) || code.includes('RAD')) return 'REJECTED';
      if (
        code === String(ApplicationStatus.HAL_QILINDI) ||
        code.includes('HAL') ||
        code.includes('JI_')
      ) {
        return 'RESOLVED';
      }
      if (cat === 'CLOSED') return 'RESOLVED';
      if (
        cat === 'IN_PROGRESS' ||
        cat === 'EXTENDED' ||
        code === String(ApplicationStatus.JARAYONDA)
      ) {
        return 'IN_PROGRESS';
      }
      if (cat === 'NEW' || code === String(ApplicationStatus.YANGI)) return 'NEW';
      return 'IN_PROGRESS';
    };

    const prevQb = this.applicationRepo
      .createQueryBuilder('app')
      .select('COUNT(app.id)', 'count')
      .where('app.is_deleted = false')
      .andWhere('COALESCE(app.date, app.created_at) BETWEEN :prevStart AND :prevEnd', {
        prevStart,
        prevEnd,
      });

    if (assignedDistrictIds !== null) {
      if (assignedDistrictIds.length > 0) {
        prevQb.andWhere('app.district_id IN (:...userDistricts)', {
          userDistricts: assignedDistrictIds,
        });
      } else {
        prevQb.andWhere('1 = 0');
      }
    }

    const prevRaw = await prevQb.getRawOne<{ count?: string | number }>();
    const prevCount = Number(prevRaw?.count ?? 0);

    const prevLossQb = this.transferRepo
      .createQueryBuilder('tr')
      .innerJoin(
        Application,
        'app',
        'app.is_deleted = false AND (app.transfer_id = tr.id OR tr.application_id = app.id)',
      )
      .select('COALESCE(SUM(tr.amount), 0)', 'loss')
      .where("(tr.currency IS NULL OR UPPER(tr.currency) = 'UZS')")
      .andWhere('COALESCE(app.date, app.created_at) BETWEEN :prevStart AND :prevEnd', {
        prevStart,
        prevEnd,
      });

    if (assignedDistrictIds !== null) {
      if (assignedDistrictIds.length > 0) {
        prevLossQb.andWhere('app.district_id IN (:...userDistricts)', {
          userDistricts: assignedDistrictIds,
        });
      } else {
        prevLossQb.andWhere('1 = 0');
      }
    }

    const prevLossRaw = await prevLossQb.getRawOne<{ loss?: string | number }>();
    const prevLoss = Number(prevLossRaw?.loss ?? 0);

    let totalLoss = 0;
    let resolvedLoss = 0;
    let maxLoss = 0;
    let newCount = 0;
    let inProgressCount = 0;
    let resolvedCount = 0;
    let rejectedCount = 0;

    const districtMap = new Map<
      string,
      {
        id: string;
        name: string;
        region_id: string | null;
        latitude: number | null;
        longitude: number | null;
        count: number;
        totalLoss: number;
      }
    >();
    const neighborhoodMap = new Map<
      string,
      {
        id: string;
        name: string;
        district_id: string;
        district_name: string | null;
        latitude: number | null;
        longitude: number | null;
        count: number;
        totalLoss: number;
      }
    >();
    const crimeMap = new Map<
      string,
      { id: string; article: string; title: string | null; gravity: string | null; count: number }
    >();
    const providerMap = new Map<string, { name: string; count: number; totalAmount: number }>();

    for (const app of applications) {
      const bucket = classifyAppBucket(app);
      if (bucket === 'NEW') newCount++;
      else if (bucket === 'IN_PROGRESS') inProgressCount++;
      else if (bucket === 'RESOLVED') resolvedCount++;
      else rejectedCount++;

      const appTransfers = getAppTransfers(app);
      const amount = getAppTotalLoss(app);
      if (amount > 0) {
        totalLoss += amount;
        if (amount > maxLoss) maxLoss = amount;
        if (bucket === 'RESOLVED') {
          resolvedLoss += amount;
        }
      }

      if (app.district) {
        const d = districtMap.get(app.district.id) || {
          id: app.district.id,
          name: app.district.name || 'Noma‘lum tuman',
          region_id: app.district.region_id ?? null,
          latitude: app.district.latitude ?? null,
          longitude: app.district.longitude ?? null,
          count: 0,
          totalLoss: 0,
        };
        d.count++;
        d.totalLoss += amount;
        districtMap.set(app.district.id, d);
      }

      if (app.citizen?.neighborhood) {
        const nKey = app.citizen.neighborhood.id;
        const n = neighborhoodMap.get(nKey) || {
          id: app.citizen.neighborhood.id,
          name: app.citizen.neighborhood.name,
          district_id: app.citizen.neighborhood.district_id,
          district_name: app.district?.name || null,
          latitude: app.citizen.neighborhood.latitude ?? null,
          longitude: app.citizen.neighborhood.longitude ?? null,
          count: 0,
          totalLoss: 0,
        };
        n.count++;
        n.totalLoss += amount;
        neighborhoodMap.set(nKey, n);
      }

      if (app.crime) {
        const c = crimeMap.get(app.crime.id) || {
          id: app.crime.id,
          article: app.crime.article || 'Noma‘lum modda',
          title: app.crime.title || null,
          gravity: app.crime.gravity || null,
          count: 0,
        };
        c.count++;
        crimeMap.set(app.crime.id, c);
      }

      for (const tr of appTransfers) {
        if (tr.payment_provider) {
          const pName = tr.payment_provider.name || 'Boshqa';
          const p = providerMap.get(pName) || { name: pName, count: 0, totalAmount: 0 };
          p.count++;
          if (!tr.currency || tr.currency.toUpperCase() === 'UZS') {
            p.totalAmount += Number(tr.amount || 0);
          }
          providerMap.set(pName, p);
        }
      }
    }

    const totalApplications = applications.length;
    const avgLoss = totalApplications > 0 ? Math.round(totalLoss / totalApplications) : 0;
    const resolutionRate =
      totalApplications > 0 ? Math.round((resolvedCount / totalApplications) * 100) : 0;

    const totalPercentChange =
      prevCount === 0
        ? totalApplications > 0
          ? 100
          : 0
        : Math.round(((totalApplications - prevCount) / prevCount) * 100);

    const lossPercentChange =
      prevLoss === 0
        ? totalLoss > 0
          ? 100
          : 0
        : Math.round(((totalLoss - prevLoss) / prevLoss) * 100);

    const timeline: Array<{
      date: string;
      label: string;
      total: number;
      resolved: number;
      in_progress: number;
      new: number;
      loss: number;
    }> = [];

    const durationDays = durationMs / (1000 * 60 * 60 * 24);

    if (period === 'today') {
      for (let h = 0; h < 24; h += 2) {
        const hourStr = `${String(h).padStart(2, '0')}:00`;
        timeline.push({
          date: hourStr,
          label: hourStr,
          total: 0,
          resolved: 0,
          in_progress: 0,
          new: 0,
          loss: 0,
        });
      }
      for (const app of applications) {
        const appDate = new Date(app.date || app.created_at);
        const h = appDate.getHours();
        const bucketIndex = Math.min(Math.floor(h / 2), timeline.length - 1);
        if (timeline[bucketIndex]) {
          const b = classifyAppBucket(app);
          timeline[bucketIndex].total++;
          timeline[bucketIndex].loss += getAppTotalLoss(app);
          if (b === 'RESOLVED') timeline[bucketIndex].resolved++;
          else if (b === 'IN_PROGRESS') timeline[bucketIndex].in_progress++;
          else if (b === 'NEW') timeline[bucketIndex].new++;
        }
      }
    } else if (durationDays <= 35) {
      const cur = new Date(start);
      const months = [
        'Yan',
        'Fev',
        'Mar',
        'Apr',
        'May',
        'Iyn',
        'Iyl',
        'Avg',
        'Sen',
        'Okt',
        'Noy',
        'Dek',
      ];
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;
        const label = `${d} ${months[cur.getMonth()]}`;
        timeline.push({
          date: key,
          label,
          total: 0,
          resolved: 0,
          in_progress: 0,
          new: 0,
          loss: 0,
        });
        cur.setDate(cur.getDate() + 1);
      }

      const timelineMap = new Map<string, (typeof timeline)[0]>();
      timeline.forEach((t) => timelineMap.set(t.date, t));

      for (const app of applications) {
        const appDate = new Date(app.date || app.created_at);
        const key = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, '0')}-${String(appDate.getDate()).padStart(2, '0')}`;
        const item = timelineMap.get(key);
        if (item) {
          const b = classifyAppBucket(app);
          item.total++;
          item.loss += getAppTotalLoss(app);
          if (b === 'RESOLVED') item.resolved++;
          else if (b === 'IN_PROGRESS') item.in_progress++;
          else if (b === 'NEW') item.new++;
        }
      }
    } else {
      const cur = new Date(start);
      cur.setDate(1);
      const months = [
        'Yanvar',
        'Fevral',
        'Mart',
        'Aprel',
        'May',
        'Iyun',
        'Iyul',
        'Avgust',
        'Sentabr',
        'Oktabr',
        'Noyabr',
        'Dekabr',
      ];
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const key = `${y}-${m}`;
        const label = `${months[cur.getMonth()]} ${y}`;
        timeline.push({
          date: key,
          label,
          total: 0,
          resolved: 0,
          in_progress: 0,
          new: 0,
          loss: 0,
        });
        cur.setMonth(cur.getMonth() + 1);
      }

      const timelineMap = new Map<string, (typeof timeline)[0]>();
      timeline.forEach((t) => timelineMap.set(t.date, t));

      for (const app of applications) {
        const appDate = new Date(app.date || app.created_at);
        const key = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, '0')}`;
        const item = timelineMap.get(key);
        if (item) {
          const b = classifyAppBucket(app);
          item.total++;
          item.loss += getAppTotalLoss(app);
          if (b === 'RESOLVED') item.resolved++;
          else if (b === 'IN_PROGRESS') item.in_progress++;
          else if (b === 'NEW') item.new++;
        }
      }
    }

    const byStatus = [
      {
        status: ApplicationStatus.YANGI,
        label: 'Yangi',
        count: newCount,
        percent: totalApplications > 0 ? Math.round((newCount / totalApplications) * 100) : 0,
        color: '#3b82f6',
      },
      {
        status: ApplicationStatus.JARAYONDA,
        label: 'Jarayonda',
        count: inProgressCount,
        percent:
          totalApplications > 0 ? Math.round((inProgressCount / totalApplications) * 100) : 0,
        color: '#f59e0b',
      },
      {
        status: ApplicationStatus.HAL_QILINDI,
        label: 'Hal qilindi',
        count: resolvedCount,
        percent: totalApplications > 0 ? Math.round((resolvedCount / totalApplications) * 100) : 0,
        color: '#10b981',
      },
      {
        status: ApplicationStatus.RAD_ETILDI,
        label: 'Rad etildi',
        count: rejectedCount,
        percent: totalApplications > 0 ? Math.round((rejectedCount / totalApplications) * 100) : 0,
        color: '#ef4444',
      },
    ];

    const allDbDistrictsRaw = await this.districtRepo.find({
      relations: { region: true },
      order: { name: 'ASC' },
    });
    // Xarita va Qashqadaryo bo'limlari statistikasi uchun faqat Qashqadaryo viloyati tumanlarini 0 bilan oldindan to'ldiramiz
    const qashqadaryoDistricts = allDbDistrictsRaw.filter(
      (d) => !d.region || d.region.code === 'QASHQADARYO',
    );
    const allDbDistricts =
      assignedDistrictIds !== null
        ? qashqadaryoDistricts.filter((d) => assignedDistrictIds.includes(d.id))
        : qashqadaryoDistricts;
    for (const d of allDbDistricts) {
      if (!districtMap.has(d.id)) {
        districtMap.set(d.id, {
          id: d.id,
          name: d.name || 'Noma‘lum tuman',
          region_id: d.region_id ?? null,
          latitude: d.latitude ?? null,
          longitude: d.longitude ?? null,
          count: 0,
          totalLoss: 0,
        });
      }
    }

    const byDistrict = Array.from(districtMap.values())
      .sort((a, b) => b.count - a.count)
      .map((d) => ({
        ...d,
        percent: totalApplications > 0 ? Math.round((d.count / totalApplications) * 100) : 0,
      }));

    const byNeighborhood = Array.from(neighborhoodMap.values())
      .sort((a, b) => b.count - a.count)
      .map((m) => ({
        ...m,
        percent: totalApplications > 0 ? Math.round((m.count / totalApplications) * 100) : 0,
      }));

    const byCrime = Array.from(crimeMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((c) => ({
        ...c,
        percent: totalApplications > 0 ? Math.round((c.count / totalApplications) * 100) : 0,
      }));

    const byPaymentProvider = Array.from(providerMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((p) => ({
        ...p,
        percent: totalLoss > 0 ? Math.round((p.totalAmount / totalLoss) * 100) : 0,
      }));

    const recentApplications = [...applications]
      .sort(
        (a, b) =>
          new Date(b.date || b.created_at).getTime() - new Date(a.date || a.created_at).getTime(),
      )
      .slice(0, 6)
      .map((a) => ({
        id: a.id,
        application_number: a.application_number,
        description: a.description,
        officer_notes: a.officer_notes,
        status: a.status,
        date: a.date ? a.date.toISOString() : null,
        created_at: a.created_at.toISOString(),
        citizen_name: a.citizen
          ? `${a.citizen.last_name || ''} ${a.citizen.first_name || ''}`.trim()
          : null,
        district_name: a.district?.name || null,
        crime_article: a.crime?.article || null,
        amount: getAppTotalLoss(a) || null,
      }));

    return {
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      summary: {
        totalApplications,
        newApplications: newCount,
        inProgressApplications: inProgressCount,
        resolvedApplications: resolvedCount,
        rejectedApplications: rejectedCount,
        totalLoss,
        resolvedLoss,
        avgLoss,
        maxLoss,
        resolutionRate,
        comparison: {
          totalPercentChange,
          lossPercentChange,
        },
      },
      timeline,
      byStatus,
      byDistrict,
      byNeighborhood,
      byCrime,
      byPaymentProvider,
      recentApplications,
      scopedDistrictNames:
        assignedDistrictIds !== null
          ? allDbDistricts.map((d) => d.name).filter((n): n is string => Boolean(n))
          : null,
    };
  }
}
