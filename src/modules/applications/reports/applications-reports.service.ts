import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { Repository } from 'typeorm';

import { Application } from '../application.entity';
import { Crime } from '../crimes/crime.entity';
import { District } from '../districts/district.entity';
import {
  DepartmentServicesQueryDto,
  OperationalMatrixQueryDto,
  RegistryReportQueryDto,
} from './dto/report-query.dto';

export const QASHQADARYO_ORDERED_DISTRICTS = [
  'Qarshi sh.',
  'Qarshi t.',
  "G'uzor t.",
  'Koson t.',
  "Yakkabog' t.",
  'Shahrisabz t.',
  'Chiroqchi t.',
  'Qamashi t.',
  'Kitob t.',
  'Kasbi t.',
  'Dehqonobod t.',
  'Nishon t.',
  'Mirishkor t.',
  'Muborak t.',
  "Ko'kdala t.",
  'Shahrisabz sh.',
  'VIIB ATSJKKB',
];

export interface OperationalMatrixRow {
  index: number;
  district_name: string;
  district_id: string | null;

  // 1 kunda (kunlik)
  daily_total: number;
  daily_fraud: number;
  daily_theft: number;
  daily_insult: number;
  daily_photo_distribution: number;
  daily_mistake_transfer: number;
  daily_other: number;

  // Moddalar kesimida dinamika
  m168_month: number;
  m168_year: number;
  m169_month: number;
  m169_year: number;
  other_month: number;
  other_year: number;

  // Jami murojaatlar
  month_total: number;
  year_total: number;
  total_168_169: number;
  repeated_count: number;

  // Tezkor tadbirlar
  search_fund: number;
  card_blocked: number;
  sanction_taken: number;

  // Jarayonda
  in_progress_total: number;
  in_progress_initiate: number;
  in_progress_other: number;

  // Rad etilgan (JPK)
  rejected_total: number;
  rejected_deceived: number;
  rejected_credit: number;
  rejected_photo: number;
  rejected_insult: number;
  rejected_money: number;
  rejected_other: number;

  // Jinoyat ishi qo'zg'atilgan (J/I)
  initiated_total: number;

  // Boshqa qarorlar
  other_crime_case: number;
  combined_case: number;
  transferred_territory: number;
}

export interface DepartmentServiceItem {
  daily: number;
  period: number;
}

export interface DepartmentServicesRow {
  index: number;
  district_name: string;
  district_id: string | null;
  organized_crime: DepartmentServiceItem;
  criminal_investigation: DepartmentServiceItem;
  cyber_security: DepartmentServiceItem;
  crime_prevention: DepartmentServiceItem;
  traffic_safety: DepartmentServiceItem;
  public_order: DepartmentServiceItem;
  probation: DepartmentServiceItem;
  spiritual_educational: DepartmentServiceItem;
  total: DepartmentServiceItem;
}

export interface RegistryReportItem {
  index: number;
  id: string;
  source: string;
  officer: string;
  date: string;
  district: string;
  application_number: string;
  author_name: string;
  description: string;
  crime_type: string;
  loss_amount: number;
  crime_method: string;
  additional_notes: string;
  card_numbers: string;
  banks: string;
  providers: string;
  phone_number: string;
  birth_date: string;
}

@Injectable()
export class ApplicationsReportsService {
  constructor(
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(District)
    private readonly districtRepo: Repository<District>,
    @InjectRepository(Crime)
    private readonly crimeRepo: Repository<Crime>,
  ) {}

  // =========================================================================
  // 1. VILOYAT TEZKOR STATISTIK HISOBOTI (OPERATIONAL MATRIX)
  // =========================================================================
  async getOperationalMatrix(dto?: OperationalMatrixQueryDto): Promise<{
    date: string;
    rows: OperationalMatrixRow[];
    total: OperationalMatrixRow;
  }> {
    const targetDateStr = dto?.date || new Date().toISOString().substring(0, 10);
    const targetDate = new Date(targetDateStr);

    const dayStart = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      0,
      0,
      0,
      0,
    );
    const dayEnd = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      23,
      59,
      59,
      999,
    );

    const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1, 0, 0, 0, 0);
    const yearStart = new Date(targetDate.getFullYear(), 0, 1, 0, 0, 0, 0);

    // Barcha arizalarni munosabatlari bilan olamiz (yil boshidan hozirgacha)
    const applications = await this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.crime', 'crime')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .leftJoinAndSelect('app.application_status', 'application_status')
      .leftJoinAndSelect('app.custom_fields', 'custom_fields')
      .where('app.is_deleted = false')
      .andWhere('COALESCE(app.date, app.created_at) >= :yearStart', { yearStart })
      .andWhere('COALESCE(app.date, app.created_at) <= :dayEnd', { dayEnd })
      .getMany();

    const dbDistricts = await this.districtRepo.find();
    const districtMapByName = new Map<string, District>();
    for (const d of dbDistricts) {
      if (d.name) {
        districtMapByName.set(d.name.toLowerCase().trim(), d);
      }
    }

    // Telefon raqamlar bo'yicha takroriylikni aniqlash
    const phoneCounts = new Map<string, number>();
    for (const app of applications) {
      const phone = app.citizen?.phone_number;
      if (phone) {
        phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
      }
    }

    // 17 ta tuman bo'yicha hisoblagichlarni tayyorlaymiz
    const rowsMap = new Map<string, OperationalMatrixRow>();
    QASHQADARYO_ORDERED_DISTRICTS.forEach((name, idx) => {
      const matchedDb = districtMapByName.get(name.toLowerCase().trim());
      rowsMap.set(name, {
        index: idx + 1,
        district_name: name,
        district_id: matchedDb?.id || null,
        daily_total: 0,
        daily_fraud: 0,
        daily_theft: 0,
        daily_insult: 0,
        daily_photo_distribution: 0,
        daily_mistake_transfer: 0,
        daily_other: 0,
        m168_month: 0,
        m168_year: 0,
        m169_month: 0,
        m169_year: 0,
        other_month: 0,
        other_year: 0,
        month_total: 0,
        year_total: 0,
        total_168_169: 0,
        repeated_count: 0,
        search_fund: 0,
        card_blocked: 0,
        sanction_taken: 0,
        in_progress_total: 0,
        in_progress_initiate: 0,
        in_progress_other: 0,
        rejected_total: 0,
        rejected_deceived: 0,
        rejected_credit: 0,
        rejected_photo: 0,
        rejected_insult: 0,
        rejected_money: 0,
        rejected_other: 0,
        initiated_total: 0,
        other_crime_case: 0,
        combined_case: 0,
        transferred_territory: 0,
      });
    });

    // Arizalarni taqsimlaymiz
    for (const app of applications) {
      const appDate = new Date(app.date || app.created_at);
      const isDaily = appDate >= dayStart && appDate <= dayEnd;
      const isMonthly = appDate >= monthStart && appDate <= dayEnd;
      const isYearly = appDate >= yearStart && appDate <= dayEnd;

      // Tumanni aniqlash
      let distName = app.district?.name;
      if (!distName || !rowsMap.has(distName)) {
        // Agar tuman aniq topilmasa, mos nomni qidiramiz
        const found = QASHQADARYO_ORDERED_DISTRICTS.find(
          (d) => distName && d.toLowerCase().includes(distName.toLowerCase()),
        );
        distName = found || 'Qarshi sh.';
      }

      const row = rowsMap.get(distName)!;
      const crimeName = (app.crime?.article || app.crime?.title || '').toLowerCase();
      const status = (app.status || app.application_status?.code || '').toUpperCase();

      const isFraud = crimeName.includes('firib') || crimeName.includes('168');
      const isTheft =
        crimeName.includes('o‘g‘ri') || crimeName.includes('ўғри') || crimeName.includes('169');
      const isInsult = crimeName.includes('haqorat') || crimeName.includes('ҳақорат');
      const isPhoto = crimeName.includes('rasm') || crimeName.includes('расм');
      const isMistake = crimeName.includes('adash') || crimeName.includes('адаш');

      // 1. Kunlik ko'rsatkichlar
      if (isDaily) {
        row.daily_total++;
        if (isFraud) row.daily_fraud++;
        else if (isTheft) row.daily_theft++;
        else if (isInsult) row.daily_insult++;
        else if (isPhoto) row.daily_photo_distribution++;
        else if (isMistake) row.daily_mistake_transfer++;
        else row.daily_other++;
      }

      // 2. Moddalar dinamikasi
      if (isMonthly) {
        row.month_total++;
        if (isFraud) row.m168_month++;
        else if (isTheft) row.m169_month++;
        else row.other_month++;
      }

      if (isYearly) {
        row.year_total++;
        if (isFraud) {
          row.m168_year++;
          row.total_168_169++;
        } else if (isTheft) {
          row.m169_year++;
          row.total_168_169++;
        } else {
          row.other_year++;
        }

        // Takroriy murojaatlar
        if (app.citizen?.phone_number && (phoneCounts.get(app.citizen.phone_number) || 0) > 1) {
          row.repeated_count++;
        }

        // Tezkor choralar
        if (app.suspect_tree && (app.suspect_tree as unknown[]).length > 0) {
          row.search_fund++;
        }
        if (app.card_id || app.transfer?.sender_card_id || app.transfer?.receiver_card_id) {
          row.card_blocked++;
        }
        if (
          app.description?.toLowerCase().includes('sanksiya') ||
          app.officer_notes?.includes('sanksiya')
        ) {
          row.sanction_taken++;
        }

        // Statuslar va natijalar
        if (status === 'JARAYONDA' || status.includes('JARAYON')) {
          row.in_progress_total++;
          if (
            app.officer_notes?.includes("qo'zg'atiladi") ||
            app.officer_notes?.includes('қўзғатилади')
          ) {
            row.in_progress_initiate++;
          } else {
            row.in_progress_other++;
          }
        } else if (status === 'RAD_ETILDI' || status.includes('RAD')) {
          row.rejected_total++;
          const desc = (app.description || '') + (app.officer_notes || '');
          if (desc.includes('kredit') || desc.includes('кредит')) row.rejected_credit++;
          else if (desc.includes('rasm') || desc.includes('расм')) row.rejected_photo++;
          else if (desc.includes('haqorat') || desc.includes('ҳақорат')) row.rejected_insult++;
          else if (desc.includes('pul') || desc.includes('пул') || desc.includes('kart'))
            row.rejected_money++;
          else if (desc.includes('aldangan') || desc.includes('алданган')) row.rejected_deceived++;
          else row.rejected_other++;
        } else if (status === 'HAL_QILINDI' || status.includes('HAL') || status.includes('J/I')) {
          row.initiated_total++;
        } else {
          // Boshqa qarorlar
          const notes = (app.officer_notes || '').toLowerCase();
          if (notes.includes('birlashtir') || notes.includes('бирлаштир')) {
            row.combined_case++;
          } else if (
            notes.includes('hudud') ||
            notes.includes('юборилган') ||
            notes.includes('yuborilgan')
          ) {
            row.transferred_territory++;
          } else {
            row.other_crime_case++;
          }
        }
      }
    }

    const rows = Array.from(rowsMap.values());

    // JAMI hisoblagichi
    const total: OperationalMatrixRow = {
      index: 0,
      district_name: 'ЖАМИ',
      district_id: null,
      daily_total: 0,
      daily_fraud: 0,
      daily_theft: 0,
      daily_insult: 0,
      daily_photo_distribution: 0,
      daily_mistake_transfer: 0,
      daily_other: 0,
      m168_month: 0,
      m168_year: 0,
      m169_month: 0,
      m169_year: 0,
      other_month: 0,
      other_year: 0,
      month_total: 0,
      year_total: 0,
      total_168_169: 0,
      repeated_count: 0,
      search_fund: 0,
      card_blocked: 0,
      sanction_taken: 0,
      in_progress_total: 0,
      in_progress_initiate: 0,
      in_progress_other: 0,
      rejected_total: 0,
      rejected_deceived: 0,
      rejected_credit: 0,
      rejected_photo: 0,
      rejected_insult: 0,
      rejected_money: 0,
      rejected_other: 0,
      initiated_total: 0,
      other_crime_case: 0,
      combined_case: 0,
      transferred_territory: 0,
    };

    for (const r of rows) {
      total.daily_total += r.daily_total;
      total.daily_fraud += r.daily_fraud;
      total.daily_theft += r.daily_theft;
      total.daily_insult += r.daily_insult;
      total.daily_photo_distribution += r.daily_photo_distribution;
      total.daily_mistake_transfer += r.daily_mistake_transfer;
      total.daily_other += r.daily_other;
      total.m168_month += r.m168_month;
      total.m168_year += r.m168_year;
      total.m169_month += r.m169_month;
      total.m169_year += r.m169_year;
      total.other_month += r.other_month;
      total.other_year += r.other_year;
      total.month_total += r.month_total;
      total.year_total += r.year_total;
      total.total_168_169 += r.total_168_169;
      total.repeated_count += r.repeated_count;
      total.search_fund += r.search_fund;
      total.card_blocked += r.card_blocked;
      total.sanction_taken += r.sanction_taken;
      total.in_progress_total += r.in_progress_total;
      total.in_progress_initiate += r.in_progress_initiate;
      total.in_progress_other += r.in_progress_other;
      total.rejected_total += r.rejected_total;
      total.rejected_deceived += r.rejected_deceived;
      total.rejected_credit += r.rejected_credit;
      total.rejected_photo += r.rejected_photo;
      total.rejected_insult += r.rejected_insult;
      total.rejected_money += r.rejected_money;
      total.rejected_other += r.rejected_other;
      total.initiated_total += r.initiated_total;
      total.other_crime_case += r.other_crime_case;
      total.combined_case += r.combined_case;
      total.transferred_territory += r.transferred_territory;
    }

    return {
      date: targetDateStr,
      rows,
      total,
    };
  }

  // =========================================================================
  // 2. SOHAVIY XIZMATLAR VA YO'NALISHLAR KESIMI (DEPARTMENT SERVICES)
  // =========================================================================
  async getDepartmentServices(dto?: DepartmentServicesQueryDto): Promise<{
    date: string;
    rows: DepartmentServicesRow[];
    total: DepartmentServicesRow;
  }> {
    const targetDateStr = dto?.date || new Date().toISOString().substring(0, 10);
    const targetDate = new Date(targetDateStr);

    const dayStart = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      0,
      0,
      0,
      0,
    );
    const dayEnd = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      23,
      59,
      59,
      999,
    );

    const periodStart = dto?.startDate
      ? new Date(dto.startDate)
      : new Date(targetDate.getFullYear(), targetDate.getMonth(), 1, 0, 0, 0, 0);
    const periodEnd = dto?.endDate ? new Date(dto.endDate) : dayEnd;

    const applications = await this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.crime', 'crime')
      .where('app.is_deleted = false')
      .andWhere('COALESCE(app.date, app.created_at) >= :periodStart', { periodStart })
      .andWhere('COALESCE(app.date, app.created_at) <= :periodEnd', { periodEnd })
      .getMany();

    const dbDistricts = await this.districtRepo.find();
    const districtMapByName = new Map<string, District>();
    for (const d of dbDistricts) {
      if (d.name) {
        districtMapByName.set(d.name.toLowerCase().trim(), d);
      }
    }

    const rowsMap = new Map<string, DepartmentServicesRow>();
    QASHQADARYO_ORDERED_DISTRICTS.forEach((name, idx) => {
      const matchedDb = districtMapByName.get(name.toLowerCase().trim());
      rowsMap.set(name, {
        index: idx + 1,
        district_name: name,
        district_id: matchedDb?.id || null,
        organized_crime: { daily: 0, period: 0 },
        criminal_investigation: { daily: 0, period: 0 },
        cyber_security: { daily: 0, period: 0 },
        crime_prevention: { daily: 0, period: 0 },
        traffic_safety: { daily: 0, period: 0 },
        public_order: { daily: 0, period: 0 },
        probation: { daily: 0, period: 0 },
        spiritual_educational: { daily: 0, period: 0 },
        total: { daily: 0, period: 0 },
      });
    });

    for (const app of applications) {
      const appDate = new Date(app.date || app.created_at);
      const isDaily = appDate >= dayStart && appDate <= dayEnd;

      let distName = app.district?.name;
      if (!distName || !rowsMap.has(distName)) {
        const found = QASHQADARYO_ORDERED_DISTRICTS.find(
          (d) => distName && d.toLowerCase().includes(distName.toLowerCase()),
        );
        distName = found || 'Qarshi sh.';
      }

      const row = rowsMap.get(distName)!;
      const crimeName = (app.crime?.article || app.crime?.title || '').toLowerCase();

      // Xizmatlarga taqsimlash
      let service: keyof Omit<
        DepartmentServicesRow,
        'index' | 'district_name' | 'district_id' | 'total'
      > = 'cyber_security';

      if (
        crimeName.includes('firib') ||
        crimeName.includes('karta') ||
        crimeName.includes('kiber')
      ) {
        service = 'cyber_security';
      } else if (crimeName.includes("o'g'ri") || crimeName.includes('ўғри')) {
        service = 'criminal_investigation';
      } else if (crimeName.includes('uyush') || crimeName.includes('guruh')) {
        service = 'organized_crime';
      } else if (crimeName.includes('yo‘l') || crimeName.includes('avto')) {
        service = 'traffic_safety';
      } else if (crimeName.includes('jamoat') || crimeName.includes('bezori')) {
        service = 'public_order';
      } else if (crimeName.includes('nazorat') || crimeName.includes('probatsiya')) {
        service = 'probation';
      } else {
        service = 'crime_prevention';
      }

      row[service].period++;
      row.total.period++;

      if (isDaily) {
        row[service].daily++;
        row.total.daily++;
      }
    }

    const rows = Array.from(rowsMap.values());

    const total: DepartmentServicesRow = {
      index: 0,
      district_name: 'ЖАМИ',
      district_id: null,
      organized_crime: { daily: 0, period: 0 },
      criminal_investigation: { daily: 0, period: 0 },
      cyber_security: { daily: 0, period: 0 },
      crime_prevention: { daily: 0, period: 0 },
      traffic_safety: { daily: 0, period: 0 },
      public_order: { daily: 0, period: 0 },
      probation: { daily: 0, period: 0 },
      spiritual_educational: { daily: 0, period: 0 },
      total: { daily: 0, period: 0 },
    };

    for (const r of rows) {
      total.organized_crime.daily += r.organized_crime.daily;
      total.organized_crime.period += r.organized_crime.period;
      total.criminal_investigation.daily += r.criminal_investigation.daily;
      total.criminal_investigation.period += r.criminal_investigation.period;
      total.cyber_security.daily += r.cyber_security.daily;
      total.cyber_security.period += r.cyber_security.period;
      total.crime_prevention.daily += r.crime_prevention.daily;
      total.crime_prevention.period += r.crime_prevention.period;
      total.traffic_safety.daily += r.traffic_safety.daily;
      total.traffic_safety.period += r.traffic_safety.period;
      total.public_order.daily += r.public_order.daily;
      total.public_order.period += r.public_order.period;
      total.probation.daily += r.probation.daily;
      total.probation.period += r.probation.period;
      total.spiritual_educational.daily += r.spiritual_educational.daily;
      total.spiritual_educational.period += r.spiritual_educational.period;
      total.total.daily += r.total.daily;
      total.total.period += r.total.period;
    }

    return {
      date: targetDateStr,
      rows,
      total,
    };
  }

  // =========================================================================
  // 3. BATAFSIL ANALITIK REESTR / JURNAL (REGISTRY REPORT)
  // =========================================================================
  async getRegistryReport(dto: RegistryReportQueryDto): Promise<{
    items: RegistryReportItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = dto.page || 1;
    const limit = dto.limit || 50;
    const skip = (page - 1) * limit;

    const qb = this.applicationRepo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.citizen', 'citizen')
      .leftJoinAndSelect('app.district', 'district')
      .leftJoinAndSelect('app.crime', 'crime')
      .leftJoinAndSelect('app.crime_method', 'crime_method')
      .leftJoinAndSelect('app.source', 'source')
      .leftJoinAndSelect('app.card', 'card')
      .leftJoinAndSelect('card.bank', 'card_bank')
      .leftJoinAndSelect('app.transfer', 'transfer')
      .leftJoinAndSelect('transfer.payment_provider', 'payment_provider')
      .leftJoinAndSelect('transfer.sender_card', 'sender_card')
      .leftJoinAndSelect('sender_card.bank', 'sender_bank')
      .leftJoinAndSelect('app.custom_fields', 'custom_fields')
      .leftJoinAndSelect('custom_fields.citizen', 'cf_citizen')
      .leftJoinAndSelect('custom_fields.card', 'cf_card')
      .leftJoinAndSelect('custom_fields.transfer', 'cf_transfer')
      .where('app.is_deleted = false');

    if (dto.search) {
      const s = `%${dto.search.trim()}%`;
      qb.andWhere(
        '(app.application_number ILIKE :s OR app.description ILIKE :s OR citizen.first_name ILIKE :s OR citizen.last_name ILIKE :s OR citizen.phone_number ILIKE :s)',
        { s },
      );
    }

    if (dto.applicationNumber?.trim()) {
      qb.andWhere('app.application_number ILIKE :regAppNum', {
        regAppNum: `%${dto.applicationNumber.trim()}%`,
      });
    }

    if (dto.citizenName?.trim()) {
      qb.andWhere(
        "CONCAT_WS(' ', citizen.last_name, citizen.first_name, citizen.middle_name) ILIKE :regCitName",
        { regCitName: `%${dto.citizenName.trim()}%` },
      );
    }

    if (dto.cardNumber?.trim()) {
      const cardDigits = dto.cardNumber.replace(/\D/g, '') || dto.cardNumber.trim();
      const regCardQ = `%${cardDigits}%`;
      qb.andWhere(
        `(
          card.card_number ILIKE :regCardQ OR card.masked_number ILIKE :regCardQ
          OR sender_card.card_number ILIKE :regCardQ OR sender_card.masked_number ILIKE :regCardQ
          OR EXISTS (
            SELECT 1 FROM transfers t
            LEFT JOIN cards rc ON rc.id = t.receiver_card_id
            WHERE (t.id = app.transfer_id OR t.application_id = app.id)
              AND (rc.card_number ILIKE :regCardQ OR rc.masked_number ILIKE :regCardQ)
          )
        )`,
        { regCardQ },
      );
    }

    if (dto.phoneNumber?.trim()) {
      const phoneDigits = dto.phoneNumber.replace(/\D/g, '') || dto.phoneNumber.trim();
      const regPhoneQ = `%${phoneDigits}%`;
      qb.andWhere(
        `(
          citizen.phone_number ILIKE :regPhoneQ
          OR CAST(app.suspect_tree AS text) ILIKE :regPhoneQ
        )`,
        { regPhoneQ },
      );
    }

    if (dto.description?.trim()) {
      qb.andWhere('(app.description ILIKE :regDesc OR app.officer_notes ILIKE :regDesc)', {
        regDesc: `%${dto.description.trim()}%`,
      });
    }

    if (dto.districtId) {
      qb.andWhere('app.district_id = :dId', { dId: dto.districtId });
    }

    if (dto.crimeId) {
      qb.andWhere('app.crime_id = :cId', { cId: dto.crimeId });
    }

    if (dto.startDate) {
      qb.andWhere('COALESCE(app.date, app.created_at) >= :startDate', {
        startDate: new Date(dto.startDate),
      });
    }

    if (dto.endDate) {
      const e = new Date(dto.endDate);
      e.setHours(23, 59, 59, 999);
      qb.andWhere('COALESCE(app.date, app.created_at) <= :endDate', { endDate: e });
    }

    qb.orderBy('app.date', 'DESC', 'NULLS LAST').addOrderBy('app.created_at', 'DESC');

    const [applications, total] = await qb.skip(skip).take(limit).getManyAndCount();

    const items: RegistryReportItem[] = applications.map((app, idx) => {
      const authorName = [app.citizen?.last_name, app.citizen?.first_name, app.citizen?.middle_name]
        .filter(Boolean)
        .join(' ');

      // Karta raqamlarini jamlash
      const cardList: string[] = [];
      const bankList: string[] = [];
      const providerList: string[] = [];

      if (app.card?.card_number) {
        cardList.push(app.card.card_number);
        if (app.card.bank?.name) bankList.push(app.card.bank.name);
      }
      if (app.transfer?.sender_card?.card_number) {
        if (!cardList.includes(app.transfer.sender_card.card_number)) {
          cardList.push(app.transfer.sender_card.card_number);
        }
        if (
          app.transfer.sender_card.bank?.name &&
          !bankList.includes(app.transfer.sender_card.bank.name)
        ) {
          bankList.push(app.transfer.sender_card.bank.name);
        }
      }
      if (app.transfer?.payment_provider?.name) {
        providerList.push(app.transfer.payment_provider.name);
      }

      // Qo'shimcha kartalar
      if (app.custom_fields) {
        for (const cf of app.custom_fields) {
          if (cf.card?.card_number && !cardList.includes(cf.card.card_number)) {
            cardList.push(cf.card.card_number);
          }
        }
      }

      const dateStr = app.date
        ? new Date(app.date).toISOString().substring(0, 10)
        : new Date(app.created_at).toISOString().substring(0, 10);

      return {
        index: skip + idx + 1,
        id: app.id,
        source: app.source?.name || '102 тизими',
        officer: app.officer_notes ? app.officer_notes.substring(0, 40) : 'Масъул ходим',
        date: dateStr,
        district: app.district?.name || '—',
        application_number: app.application_number || '—',
        author_name: authorName || '—',
        description: app.description || '—',
        crime_type: app.crime?.article || app.crime?.title || 'Фирибгарлик',
        loss_amount: Number(app.transfer?.amount || 0),
        crime_method: app.crime_method?.name || 'Пластик картадан пул ечиш',
        additional_notes: app.officer_notes || '',
        card_numbers: cardList.join(', ') || '—',
        banks: bankList.join(', ') || '—',
        providers: providerList.join(', ') || '—',
        phone_number: app.citizen?.phone_number || '—',
        birth_date: app.citizen?.birth_date
          ? new Date(app.citizen.birth_date).toISOString().substring(0, 10)
          : '—',
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  // =========================================================================
  // 4. EXCEL EXPORT: VILOYAT TEZKOR STATISTIKASI (IMAGE 1 REPLIKATSIYASI)
  // =========================================================================
  async exportOperationalMatrixExcel(dto?: OperationalMatrixQueryDto): Promise<ExcelJS.Workbook> {
    const data = await this.getOperationalMatrix(dto);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Тезкор_кўрсаткичлар', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }],
    });

    // Sarlavha (Title) — barcha 36 ustun (A..AJ)
    sheet.mergeCells('A1:AJ1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `${data.date} КУНИДАГИ КЕЛИБ ТУШГАН МУРОЖААТЛАР БЎЙИЧА ТЕЗКОР ҲИСОБОТ`;
    titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 28;

    // 1-Qavat Header (Merged Groups)
    sheet.mergeCells('A3:A5');
    sheet.getCell('A3').value = '№';

    sheet.mergeCells('B3:B5');
    sheet.getCell('B3').value = 'Шаҳар / туманлар';

    // 1 kunda guruhi
    sheet.mergeCells('C3:I3');
    sheet.getCell('C3').value = '1 кунда, шундан';

    sheet.mergeCells('C4:C5');
    sheet.getCell('C4').value = `${data.date} кунидаги жами`;

    sheet.getCell('D4').value = 'Фирибгарлик';
    sheet.getCell('E4').value = 'Ўғрилик';
    sheet.getCell('F4').value = 'Ҳақорат қилиш';
    sheet.getCell('G4').value = 'Расм тарқатиш';
    sheet.getCell('H4').value = 'Адашиб ташлаган';
    sheet.getCell('I4').value = 'Бошқа';

    // Moddalar kesimida
    sheet.mergeCells('J3:O3');
    sheet.getCell('J3').value = 'Моддалар кесимида динамика';
    sheet.getCell('J4').value = '168-м (Ой)';
    sheet.getCell('K4').value = '168-м (Йил)';
    sheet.getCell('L4').value = '169-м (Ой)';
    sheet.getCell('M4').value = '169-м (Йил)';
    sheet.getCell('N4').value = 'Бошқа (Ой)';
    sheet.getCell('O4').value = 'Бошқа (Йил)';

    // Jami murojaatlar
    sheet.mergeCells('P3:S3');
    sheet.getCell('P3').value = 'Мурожаатлар';
    sheet.getCell('P4').value = 'Ой бошидан жами';
    sheet.getCell('Q4').value = 'Йил бошидан жами';
    sheet.getCell('R4').value = 'Шундан 168/169-м';
    sheet.getCell('S4').value = 'Шундан такрорий';

    // Tezkor tadbirlar
    sheet.mergeCells('T3:V3');
    sheet.getCell('T3').value = 'Тезкор чоралар';
    sheet.getCell('T4').value = 'Қидирув фонди';
    sheet.getCell('U4').value = 'Card Block берилди';
    sheet.getCell('V4').value = 'Санкция олинди';

    // Jarayonda
    sheet.mergeCells('W3:Y3');
    sheet.getCell('W3').value = 'Жараёнда';
    sheet.getCell('W4').value = 'ЖАМИ';
    sheet.getCell('X4').value = 'қўзғатилади';
    sheet.getCell('Y4').value = 'бошқа';

    // Rad etilgan (JPK)
    sheet.mergeCells('Z3:AF3');
    sheet.getCell('Z3').value = 'ЖИ қўзғатиш рад этилган';
    sheet.getCell('Z4').value = 'ЖАМИ';
    sheet.getCell('AA4').value = 'Алданган';
    sheet.getCell('AB4').value = 'Кредит';
    sheet.getCell('AC4').value = 'Расм';
    sheet.getCell('AD4').value = 'Ҳақорат';
    sheet.getCell('AE4').value = 'Пул б-н боғлиқ';
    sheet.getCell('AF4').value = 'Бошқа';

    // Jinoyat ishi qo'zg'atilgan (J/I)
    sheet.mergeCells('AG3:AG5');
    sheet.getCell('AG3').value = 'Ж/И қўзғатилган';

    // Boshqa qarorlar
    sheet.mergeCells('AH3:AJ3');
    sheet.getCell('AH3').value = 'Бошқа';
    sheet.getCell('AH4').value = 'Иш доирасида';
    sheet.getCell('AI4').value = 'Бирлаштирилган';
    sheet.getCell('AJ4').value = 'Ҳудудийлик б-н';

    // 5-qator: Ustunlar raqami (1, 2, 3...)
    const colCount = 36;
    for (let c = 1; c <= colCount; c++) {
      const cell = sheet.getRow(5).getCell(c);
      if (!cell.value) {
        cell.value = c;
      }
    }

    // Ranglar va stil berish (Header styling)
    const headerRow3 = sheet.getRow(3);
    const headerRow4 = sheet.getRow(4);
    const headerRow5 = sheet.getRow(5);

    headerRow3.height = 22;
    headerRow4.height = 26;
    headerRow5.height = 18;

    [headerRow3, headerRow4, headerRow5].forEach((row) => {
      row.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 9, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          left: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
          right: { style: 'thin', color: { argb: 'FF94A3B8' } },
        };
      });
    });

    // Ranglar (Pastel groups matching Image 1):
    // 1 kunda (Pinkish / violet tint: FCE7F3)
    for (let c = 3; c <= 9; c++) {
      sheet.getCell(3, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFCE7F3' },
      };
      sheet.getCell(4, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFDF2F8' },
      };
    }
    // Moddalar (Light cyan: E0F2FE)
    for (let c = 10; c <= 15; c++) {
      sheet.getCell(3, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0F2FE' },
      };
      sheet.getCell(4, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0F9FF' },
      };
    }
    // Jami murojaatlar (Light yellow: FEF9C3)
    for (let c = 16; c <= 19; c++) {
      sheet.getCell(3, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF9C3' },
      };
      sheet.getCell(4, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEFCE8' },
      };
    }
    // Jarayonda (Soft orange: FFEDD5)
    for (let c = 23; c <= 25; c++) {
      sheet.getCell(3, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEDD5' },
      };
      sheet.getCell(4, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF7ED' },
      };
    }
    // Rad etilgan (Soft green: DCFCE7)
    for (let c = 26; c <= 32; c++) {
      sheet.getCell(3, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCFCE7' },
      };
      sheet.getCell(4, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0FDF4' },
      };
    }

    // 17 ta tuman ma'lumotlarini qo'shish
    let currentRowNum = 6;
    for (const r of data.rows) {
      const row = sheet.getRow(currentRowNum);
      row.values = [
        r.index,
        r.district_name,
        r.daily_total,
        r.daily_fraud,
        r.daily_theft,
        r.daily_insult,
        r.daily_photo_distribution,
        r.daily_mistake_transfer,
        r.daily_other,
        r.m168_month,
        r.m168_year,
        r.m169_month,
        r.m169_year,
        r.other_month,
        r.other_year,
        r.month_total,
        r.year_total,
        r.total_168_169,
        r.repeated_count,
        r.search_fund,
        r.card_blocked,
        r.sanction_taken,
        r.in_progress_total,
        r.in_progress_initiate,
        r.in_progress_other,
        r.rejected_total,
        r.rejected_deceived,
        r.rejected_credit,
        r.rejected_photo,
        r.rejected_insult,
        r.rejected_money,
        r.rejected_other,
        r.initiated_total,
        r.other_crime_case,
        r.combined_case,
        r.transferred_territory,
      ];

      row.height = 20;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 10, bold: colNumber === 2 };
        cell.alignment = {
          horizontal: colNumber === 2 ? 'left' : 'center',
          vertical: 'middle',
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });

      currentRowNum++;
    }

    // Pastki JAMI satri
    const totalRowNum = currentRowNum;
    const totalRow = sheet.getRow(totalRowNum);
    const totalValues: (string | number | { formula: string })[] = ['', 'ЖАМИ'];

    for (let c = 3; c <= colCount; c++) {
      const colLetter = sheet.getColumn(c).letter;
      totalValues.push({ formula: `SUM(${colLetter}6:${colLetter}${totalRowNum - 1})` });
    }
    totalRow.values = totalValues;
    totalRow.height = 24;

    totalRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
      cell.alignment = {
        horizontal: colNumber === 2 ? 'left' : 'center',
        vertical: 'middle',
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEDD5' }, // Iliq shaftoli / sarg'ish jami foni
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF475569' } },
        bottom: { style: 'double', color: { argb: 'FF475569' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
    });

    // Ustun kengliklari
    sheet.getColumn(1).width = 5;
    sheet.getColumn(2).width = 18;
    for (let c = 3; c <= colCount; c++) {
      sheet.getColumn(c).width = 9;
    }

    return Promise.resolve(workbook);
  }

  // =========================================================================
  // 5. EXCEL EXPORT: SOHAVIY XIZMATLAR (IMAGE 3 REPLIKATSIYASI)
  // =========================================================================
  async exportDepartmentServicesExcel(dto?: DepartmentServicesQueryDto): Promise<ExcelJS.Workbook> {
    const data = await this.getDepartmentServices(dto);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Соҳавий_хизматлар', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
    });

    sheet.mergeCells('A1:R1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `СОҲАВИЙ ХИЗМАТЛАР КЎРСАТКИЧЛАРИ ҲИСОБОТИ (${data.date})`;
    titleCell.font = { name: 'Calibri', size: 13, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 26;

    sheet.mergeCells('A3:A4');
    sheet.getCell('A3').value = '№';
    sheet.mergeCells('B3:B4');
    sheet.getCell('B3').value = 'Туман (шаҳар)';

    const services = [
      'Уюшган жиноятчиликка қарши',
      'Жиноят қидирув хизмати',
      'Киберхавфсизлик (АТСЖКҚБ)',
      'Ҳуқуқбузарликлар профилактикаси',
      'Йўл ҳаракати хавфсизлиги',
      'Жамоат тартибини сақлаш',
      'Пробация хизмати',
      'Жами кўрсаткич',
    ];

    let startCol = 3;
    services.forEach((s) => {
      const endCol = startCol + 1;
      const startLetter = sheet.getColumn(startCol).letter;
      const endLetter = sheet.getColumn(endCol).letter;

      sheet.mergeCells(`${startLetter}3:${endLetter}3`);
      sheet.getCell(`${startLetter}3`).value = s;

      sheet.getCell(`${startLetter}4`).value = 'Бир кунда';
      sheet.getCell(`${endLetter}4`).value = 'Тадбир бошидан';

      startCol += 2;
    });

    const headerRow3 = sheet.getRow(3);
    const headerRow4 = sheet.getRow(4);
    headerRow3.height = 24;
    headerRow4.height = 20;

    [headerRow3, headerRow4].forEach((row) => {
      row.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 9, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          left: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
          right: { style: 'thin', color: { argb: 'FF94A3B8' } },
        };
      });
    });

    let current = 5;
    for (const r of data.rows) {
      const row = sheet.getRow(current);
      row.values = [
        r.index,
        r.district_name,
        r.organized_crime.daily,
        r.organized_crime.period,
        r.criminal_investigation.daily,
        r.criminal_investigation.period,
        r.cyber_security.daily,
        r.cyber_security.period,
        r.crime_prevention.daily,
        r.crime_prevention.period,
        r.traffic_safety.daily,
        r.traffic_safety.period,
        r.public_order.daily,
        r.public_order.period,
        r.probation.daily,
        r.probation.period,
        r.total.daily,
        r.total.period,
      ];
      row.height = 19;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 10, bold: colNumber === 2 };
        cell.alignment = {
          horizontal: colNumber === 2 ? 'left' : 'center',
          vertical: 'middle',
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
      current++;
    }

    const totalRow = sheet.getRow(current);
    const totalVals: (string | number | { formula: string })[] = ['', 'ЖАМИ'];
    for (let c = 3; c <= 18; c++) {
      const colLetter = sheet.getColumn(c).letter;
      totalVals.push({ formula: `SUM(${colLetter}5:${colLetter}${current - 1})` });
    }
    totalRow.values = totalVals;
    totalRow.height = 24;
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 10, bold: true };
      cell.alignment = { horizontal: colNumber === 2 ? 'left' : 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF475569' } },
        bottom: { style: 'double', color: { argb: 'FF475569' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
    });

    sheet.getColumn(1).width = 5;
    sheet.getColumn(2).width = 18;
    for (let c = 3; c <= 18; c++) {
      sheet.getColumn(c).width = 12;
    }

    return Promise.resolve(workbook);
  }

  // =========================================================================
  // 6. EXCEL EXPORT: BATAFSIL REESTR / JURNAL (IMAGE 2 REPLIKATSIYASI)
  // =========================================================================
  async exportRegistryExcel(dto: RegistryReportQueryDto): Promise<ExcelJS.Workbook> {
    const data = await this.getRegistryReport({ ...dto, page: 1, limit: 10000 });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Мурожаатлар_реестри', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
    });

    sheet.getRow(1).height = 36;
    sheet.getRow(2).height = 18;

    const headers = [
      { text: '№', width: 6, fill: 'FFDCFCE7' },
      { text: 'МУРОЖААТ МАНБАСИ\n(102 тизими / ариза)', width: 16, fill: 'FFDCFCE7' },
      { text: 'Э-материалдаги\nижрочи', width: 20, fill: 'FFDCFCE7' },
      { text: 'Сана', width: 12, fill: 'FFDCFCE7' },
      { text: 'Хабар тушган\nҳудуд', width: 15, fill: 'FFDCFCE7' },
      { text: 'Э-материал\nрақами', width: 16, fill: 'FFDCFCE7' },
      { text: 'Мурожаат муаллифи\n(Ф.И.Ш)', width: 26, fill: 'FFDCFCE7' },
      { text: 'Ҳолатнинг қисқача мазмуни\n(Фабула)', width: 45, fill: 'FFDCFCE7' },
      { text: 'Мурожаат тури\n(модда)', width: 16, fill: 'FFBAE6FD' },
      { text: 'Моддий зарар\nмиқдори (сўм)', width: 18, fill: 'FFBAE6FD' },
      { text: 'Содир этиш\nусули', width: 24, fill: 'FFBAE6FD' },
      { text: 'Қўшимча изоҳ', width: 22, fill: 'FFBAE6FD' },
      { text: 'Жабрланувчи\nкарта рақами', width: 20, fill: 'FFFEF08A' },
      { text: 'Қайси банкка\nтегишли', width: 18, fill: 'FFFEF08A' },
      { text: 'Қайси мобил\nиловадан', width: 16, fill: 'FFFEF08A' },
      { text: 'Аризачининг\nтелефон рақами', width: 18, fill: 'FFBBF7D0' },
      { text: 'Туғилган куни,\nойи, йили', width: 15, fill: 'FFBBF7D0' },
    ];

    headers.forEach((h, idx) => {
      const colNum = idx + 1;
      const cell1 = sheet.getCell(1, colNum);
      const cell2 = sheet.getCell(2, colNum);

      cell1.value = h.text;
      cell2.value = colNum;

      cell1.font = { name: 'Calibri', size: 9, bold: true };
      cell2.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748B' } };

      cell1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell2.alignment = { horizontal: 'center', vertical: 'middle' };

      cell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: h.fill } };
      cell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

      [cell1, cell2].forEach((c) => {
        c.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          left: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
          right: { style: 'thin', color: { argb: 'FF94A3B8' } },
        };
      });

      sheet.getColumn(colNum).width = h.width;
    });

    sheet.autoFilter = {
      from: 'A2',
      to: `${sheet.getColumn(headers.length).letter}2`,
    };

    let rowIdx = 3;
    for (const item of data.items) {
      const row = sheet.getRow(rowIdx);
      row.values = [
        item.index,
        item.source,
        item.officer,
        item.date,
        item.district,
        item.application_number,
        item.author_name,
        item.description,
        item.crime_type,
        item.loss_amount,
        item.crime_method,
        item.additional_notes,
        item.card_numbers,
        item.banks,
        item.providers,
        item.phone_number,
        item.birth_date,
      ];

      row.height = 24;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 9 };
        cell.alignment = {
          vertical: 'middle',
          horizontal:
            colNumber === 10 ? 'right' : [1, 4, 6, 16, 17].includes(colNumber) ? 'center' : 'left',
          wrapText: [8, 11, 12, 13].includes(colNumber),
        };
        if (colNumber === 10 && typeof cell.value === 'number') {
          cell.numFmt = '#,##0 "UZS"';
        }
        if ([6, 13, 16].includes(colNumber)) {
          cell.numFmt = '@';
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });

      rowIdx++;
    }

    if (rowIdx > 3) {
      const totalRow = sheet.getRow(rowIdx);
      totalRow.getCell(9).value = 'ЖАМИ ЗАРАР:';
      totalRow.getCell(10).value = { formula: `SUM(J3:J${rowIdx - 1})` };
      totalRow.height = 26;
      for (let col = 1; col <= headers.length; col++) {
        const c = totalRow.getCell(col);
        c.font = { name: 'Calibri', size: 10, bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'double', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
      }
      totalRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell(10).alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell(10).numFmt = '#,##0 "UZS"';
    }

    return Promise.resolve(workbook);
  }
}
