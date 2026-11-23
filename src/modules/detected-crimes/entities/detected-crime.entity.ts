import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { SuspectTreeNode } from '../../applications/application.entity';
import { Crime } from '../../applications/crimes/crime.entity';
import { CrimeMethod } from '../../applications/crimes/methods/crime-method.entity';
import { DecisionType } from '../../applications/decision-types/decision-type.entity';
import { DepartmentService } from '../../applications/department-services/department-service.entity';
import { District } from '../../applications/districts/district.entity';
import { ApplicationStatus } from '../../applications/statuses/application-status.entity';
import { User } from '../../users/user.entity';
import { DetectedCrimeEvidence } from './detected-crime-evidence.entity';
import { DetectedCrimeStatus } from './detected-crime-status.entity';
import { DetectedCrimeSuspect } from './detected-crime-suspect.entity';
import { DetectionSource } from './detection-source.entity';

export type DetectedCrimeMeasureType =
  | 'CARD_BLOCKED'
  | 'CHANNEL_BLOCKED'
  | 'DEVICE_SEIZED'
  | 'EXPERTISE_ORDERED'
  | 'SUSPECT_DETAINED'
  | 'SENT_TO_INVESTIGATION'
  | 'SENT_TO_COURT'
  | 'DAMAGE_RECOVERED'
  | 'TRANSFERRED_AGENCY'
  | 'OTHER';

export interface DetectedCrimeMeasure {
  id: string;
  measure_type: DetectedCrimeMeasureType;
  title: string;
  date?: string | null;
  reference_number?: string | null;
  notes?: string | null;
}

export enum DetectedCrimeQualification {
  PRE_INVESTIGATION = 'PRE_INVESTIGATION',
  CRIMINAL = 'CRIMINAL',
  ADMINISTRATIVE = 'ADMINISTRATIVE',
}

@Entity('detected_crimes')
@Index('IDX_detected_crimes_is_deleted_date', ['is_deleted', 'detected_at'])
@Index('IDX_detected_crimes_district_id', ['district_id'])
@Index('IDX_detected_crimes_status_id', ['status_id'])
@Index('IDX_detected_crimes_crime_id', ['crime_id'])
@Index('IDX_detected_crimes_deadline_at', ['deadline_at'])
export class DetectedCrime extends BaseEntity {
  @Column({ name: 'case_number', type: 'varchar', length: 60, unique: true, nullable: true })
  case_number: string | null;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  // Bildirgi (Raport) va KUSP / E-material rekvizitlari (JPK 322-m. 4-b.)
  @Column({ name: 'report_number', type: 'varchar', length: 120, nullable: true })
  report_number: string | null;

  @Column({ name: 'report_date', type: 'timestamp with time zone', nullable: true })
  report_date: Date | null;

  @Column({ name: 'kusp_number', type: 'varchar', length: 120, nullable: true })
  kusp_number: string | null;

  @Column({
    name: 'detected_at',
    type: 'timestamp with time zone',
    default: () => 'CURRENT_TIMESTAMP',
  })
  detected_at: Date;

  // Huquqiy malaka (Tekshiruvda / JK / MJTK)
  @Column({
    name: 'qualification_type',
    type: 'varchar',
    length: 30,
    default: DetectedCrimeQualification.PRE_INVESTIGATION,
  })
  qualification_type: DetectedCrimeQualification;

  @Column({ name: 'crime_id', type: 'uuid', nullable: true })
  crime_id: string | null;

  @ManyToOne(() => Crime, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'crime_id' })
  crime: Crime | null;

  @Column({ name: 'crime_method_id', type: 'uuid', nullable: true })
  crime_method_id: string | null;

  @ManyToOne(() => CrimeMethod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'crime_method_id' })
  crime_method: CrimeMethod | null;

  @Column({ name: 'mjtk_article', type: 'varchar', length: 150, nullable: true })
  mjtk_article: string | null;

  // Aniqlash usuli / manbasi
  @Column({ name: 'detection_source_id', type: 'uuid', nullable: true })
  detection_source_id: string | null;

  @ManyToOne(() => DetectionSource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'detection_source_id' })
  detection_source: DetectionSource | null;

  // Hudud va Sohaviy xizmat
  @Column({ name: 'district_id', type: 'uuid', nullable: true })
  district_id: string | null;

  @ManyToOne(() => District, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'district_id' })
  district: District | null;

  @Column({ name: 'department_service_id', type: 'uuid', nullable: true })
  department_service_id: string | null;

  @ManyToOne(() => DepartmentService, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_service_id' })
  department_service: DepartmentService | null;

  // Platforma va raqamli izlar
  @Column({ name: 'platform', type: 'varchar', length: 100, nullable: true })
  platform: string | null;

  @Column({ name: 'channel_or_source_url', type: 'varchar', length: 500, nullable: true })
  channel_or_source_url: string | null;

  @Column({ name: 'suspect_tree', type: 'jsonb', nullable: true, default: () => "'[]'" })
  suspect_tree: SuspectTreeNode[] | null;

  @Column({ name: 'estimated_damage', type: 'numeric', precision: 18, scale: 2, nullable: true })
  estimated_damage: number | null;

  @Column({ name: 'officer_notes', type: 'text', nullable: true })
  officer_notes: string | null;

  // Aniqlangan jinoyatning o'z alohida statusi va ko'rilgan choralar
  @Column({ name: 'crime_status_id', type: 'uuid', nullable: true })
  crime_status_id: string | null;

  @ManyToOne(() => DetectedCrimeStatus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'crime_status_id' })
  crime_status: DetectedCrimeStatus | null;

  @Column({ name: 'measures', type: 'jsonb', default: () => "'[]'" })
  measures: DetectedCrimeMeasure[];

  // Eski legacy ustunlar (orqaga moslik uchun saqlanadi)
  @Column({ name: 'status_id', type: 'uuid', nullable: true })
  status_id: string | null;

  @ManyToOne(() => ApplicationStatus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'status_id' })
  application_status: ApplicationStatus | null;

  @Column({ name: 'decision_type_id', type: 'uuid', nullable: true })
  decision_type_id: string | null;

  @ManyToOne(() => DecisionType, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decision_type_id' })
  decision_type: DecisionType | null;

  @Column({ name: 'decision_number', type: 'varchar', length: 120, nullable: true })
  decision_number: string | null;

  @Column({ name: 'decision_date', type: 'timestamp with time zone', nullable: true })
  decision_date: Date | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decision_note: string | null;

  @Column({ name: 'deadline_at', type: 'timestamp with time zone', nullable: true })
  deadline_at: Date | null;

  @Column({ name: 'sla_days', type: 'int', nullable: true })
  sla_days: number | null;

  @Column({ name: 'extended_until', type: 'timestamp with time zone', nullable: true })
  extended_until: Date | null;

  @Column({ name: 'extension_reason', type: 'text', nullable: true })
  extension_reason: string | null;

  @Column({ name: 'prosecutor_approval_number', type: 'varchar', length: 120, nullable: true })
  prosecutor_approval_number: string | null;

  @Column({ name: 'closed_at', type: 'timestamp with time zone', nullable: true })
  closed_at: Date | null;

  // Aniqlagan va kiritgan xodimlar
  @Column({ name: 'detected_by_id', type: 'uuid', nullable: true })
  detected_by_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'detected_by_id' })
  detected_by: User | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  created_by_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  created_by: User | null;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ name: 'deleted_at', type: 'timestamp with time zone', nullable: true })
  deleted_at: Date | null;

  @Column({ name: 'deleted_by_id', type: 'uuid', nullable: true })
  deleted_by_id: string | null;

  // Bog'langan gumonlanuvchilar va ashyoviy dalillar
  @OneToMany(() => DetectedCrimeSuspect, (s) => s.detected_crime, { cascade: true })
  suspects: DetectedCrimeSuspect[];

  @OneToMany(() => DetectedCrimeEvidence, (e) => e.detected_crime, { cascade: true })
  evidences: DetectedCrimeEvidence[];
}
