import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '../../common/database/base.entity';
import {
  AppealType,
  ApplicantType,
  ApplicationRepeatType,
  SubmissionForm,
} from '../../common/enums/appeal-classification.enum';
import { User } from '../users/user.entity';
import { ApplicationStatusHistory } from './application-status-history.entity';
import { AwarenessStatus } from './awareness-statuses/awareness-status.entity';
import { Citizen } from './citizens/citizen.entity';
import { Crime } from './crimes/crime.entity';
import { CrimeMethod } from './crimes/methods/crime-method.entity';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { ApplicationDamage } from './damages/application-damage.entity';
import { DecisionType } from './decision-types/decision-type.entity';
import { DepartmentService } from './department-services/department-service.entity';
import { District } from './districts/district.entity';
import { ApplicationDocument } from './documents/application-document.entity';
import { ApplicationExternalSystem } from './external-systems/application-external-system.entity';
import { RejectionReason } from './rejection-reasons/rejection-reason.entity';
import { ApplicationSource } from './sources/application-source.entity';
import { ApplicationStatus as ApplicationStatusEntity } from './statuses/application-status.entity';
import { Card } from './transfers/cards/card.entity';
import { Transfer } from './transfers/transfer.entity';
import { Workplace } from './workplaces/workplace.entity';

export interface SuspectTreeNode {
  id: string;
  label: string;
  value?: string;
  children?: SuspectTreeNode[];
}

@Entity('applications')
@Index('IDX_applications_is_deleted_date', ['is_deleted', 'date'])
@Index('IDX_applications_district_id', ['district_id'])
@Index('IDX_applications_status_id', ['status_id'])
@Index('IDX_applications_citizen_id', ['citizen_id'])
@Index('IDX_applications_crime_id', ['crime_id'])
@Index('IDX_applications_card_id', ['card_id'])
@Index('IDX_applications_transfer_id', ['transfer_id'])
@Index('IDX_applications_created_by_id', ['created_by_id'])
@Index('IDX_applications_deadline_at', ['deadline_at'])
@Index('IDX_applications_appeal_type', ['appeal_type'])
@Index('IDX_applications_repeat_type', ['repeat_type'])
@Index('IDX_applications_parent_application_id', ['parent_application_id'])
@Index('IDX_applications_root_application_id', ['root_application_id'])
@Index('IDX_applications_awareness_status_id', ['awareness_status_id'])
export class Application extends BaseEntity {
  /**
   * Arizaning rasmiy qayd raqami.
   * Format: YYYY-XXXXX (masalan: 2026-00451). Prefikssiz (AR- yoki ARIZA- siz).
   */
  @Column({
    name: 'application_number',
    type: 'varchar',
    length: 50,
    unique: true,
    nullable: true,
  })
  application_number: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'officer_notes', type: 'text', nullable: true })
  officer_notes: string | null;

  /**
   * Firibgar / Gumonlanuvchi dinamik daraxti (Telegram -> username -> tilav_web, va h.k.)
   */
  @Column({ name: 'suspect_tree', type: 'jsonb', nullable: true, default: () => "'[]'" })
  suspect_tree: SuspectTreeNode[] | null;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'YANGI',
    name: 'status',
    nullable: true,
  })
  status: string | null;

  @Column({ name: 'status_id', type: 'uuid', nullable: true })
  status_id: string | null;

  @ManyToOne(() => ApplicationStatusEntity, (st) => st.applications, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'status_id' })
  application_status: ApplicationStatusEntity | null;

  @Column({
    name: 'date',
    type: 'timestamp with time zone',
    default: () => 'CURRENT_TIMESTAMP',
    nullable: true,
  })
  date: Date | null;

  // ==========================================================================
  // PROTSESSUAL MUDDATLAR (JPK 329-modda: 3 / 10 / 30 kun) VA YAKUNIY QAROR
  // ==========================================================================
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

  @Column({ name: 'prosecutor_approval_date', type: 'timestamp with time zone', nullable: true })
  prosecutor_approval_date: Date | null;

  @Column({ name: 'decision_number', type: 'varchar', length: 120, nullable: true })
  decision_number: string | null;

  @Column({ name: 'decision_date', type: 'timestamp with time zone', nullable: true })
  decision_date: Date | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decision_note: string | null;

  @Column({ name: 'closed_at', type: 'timestamp with time zone', nullable: true })
  closed_at: Date | null;

  // ==========================================================================
  // MUROJAAT TASNIFI VA TAKRORIY / DUBLIKAT / QO'SHIMCHA ZANJIRI (O'RQ-445)
  // ==========================================================================
  @Column({
    name: 'appeal_type',
    type: 'varchar',
    length: 30,
    default: AppealType.APPEAL,
  })
  appeal_type: AppealType;

  @Column({
    name: 'submission_form',
    type: 'varchar',
    length: 30,
    default: SubmissionForm.WRITTEN,
  })
  submission_form: SubmissionForm;

  @Column({
    name: 'applicant_type',
    type: 'varchar',
    length: 30,
    default: ApplicantType.INDIVIDUAL,
  })
  applicant_type: ApplicantType;

  @Column({
    name: 'repeat_type',
    type: 'varchar',
    length: 30,
    default: ApplicationRepeatType.PRIMARY,
  })
  repeat_type: ApplicationRepeatType;

  @Column({ name: 'parent_application_id', type: 'uuid', nullable: true })
  parent_application_id: string | null;

  @ManyToOne(() => Application, (app) => app.child_applications, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_application_id' })
  parent_application: Application | null;

  @OneToMany(() => Application, (app) => app.parent_application)
  child_applications: Application[];

  @Column({ name: 'root_application_id', type: 'uuid', nullable: true })
  root_application_id: string | null;

  @ManyToOne(() => Application, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'root_application_id' })
  root_application: Application | null;

  @Column({ name: 'repeat_sequence', type: 'int', default: 1 })
  repeat_sequence: number;

  @Column({ name: 'repeat_reason', type: 'text', nullable: true })
  repeat_reason: string | null;

  @Column({ name: 'is_review_terminated', type: 'boolean', default: false })
  is_review_terminated: boolean;

  @Column({ name: 'termination_note', type: 'text', nullable: true })
  termination_note: string | null;

  /** Zanjirdagi jami bog'liq murojaatlar soni (Virtual/hisoblangan maydon) */
  chain_count?: number;

  @OneToMany(() => ApplicationStatusHistory, (h: ApplicationStatusHistory) => h.application)
  status_history: ApplicationStatusHistory[];

  // ==========================================================================
  // 1. DINAMIK MAYDONLAR (Yagona dinamik massiv - Universal Custom Fields)
  // ==========================================================================
  @OneToMany(() => ApplicationCustomField, (field) => field.application, {
    cascade: true,
  })
  custom_fields: ApplicationCustomField[];

  // ==========================================================================
  // 1.1. KARTASIZ MODDIY ZARARLAR (Onlayn kredit, Nasiya, Tovar/Xizmat aldovi)
  // ==========================================================================
  @OneToMany(() => ApplicationDamage, (damage) => damage.application, {
    cascade: true,
  })
  damages: ApplicationDamage[];

  // ==========================================================================
  // 2. ASOSIY BIRLAMCHI MODELLAR (Har biridan bittadan ManyToOne)
  // ==========================================================================

  // 1. Asosiy arizachi Fuqaro
  @Column({ name: 'citizen_id', type: 'uuid', nullable: true })
  citizen_id: string | null;

  @ManyToOne(() => Citizen, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen | null;

  // 2. Asosiy Jinoyat moddasi
  @Column({ name: 'crime_id', type: 'uuid', nullable: true })
  crime_id: string | null;

  @ManyToOne(() => Crime, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'crime_id' })
  crime: Crime | null;

  // 2.1. Jinoyat sodir etish usuli
  @Column({ name: 'crime_method_id', type: 'uuid', nullable: true })
  crime_method_id: string | null;

  @ManyToOne(() => CrimeMethod, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'crime_method_id' })
  crime_method: CrimeMethod | null;

  // 3. Asosiy Tuman / Bo'lim
  @Column({ name: 'district_id', type: 'uuid', nullable: true })
  district_id: string | null;

  @ManyToOne(() => District, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'district_id' })
  district: District | null;

  // 4. Asosiy Plastik karta (Jabrlanuvchi kartasi)
  @Column({ name: 'card_id', type: 'uuid', nullable: true })
  card_id: string | null;

  @ManyToOne(() => Card, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'card_id' })
  card: Card | null;

  // 5. Asosiy To'lov o'tkazmasi
  @Column({ name: 'transfer_id', type: 'uuid', nullable: true })
  transfer_id: string | null;

  @ManyToOne(() => Transfer, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'transfer_id' })
  transfer: Transfer | null;

  // 6. Murojaat manbasi (102, 112, Ishonch telefoni va h.k.)
  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  source_id: string | null;

  @ManyToOne(() => ApplicationSource, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'source_id' })
  source: ApplicationSource | null;

  // 6.1. Fuqaro targ'ibot qilinganligi holati (Qilinmagan / IIB / Onlayn va b.)
  @Column({ name: 'awareness_status_id', type: 'uuid', nullable: true })
  awareness_status_id: string | null;

  @ManyToOne(() => AwarenessStatus, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'awareness_status_id' })
  awareness_status: AwarenessStatus | null;

  @Column({ name: 'awareness_note', type: 'varchar', length: 300, nullable: true })
  awareness_note: string | null;

  // 7. Sohaviy xizmat (UYOKK, JQK, Terrorizm, HQPX, YHX, JTSX, Probatsiya, MMIX)
  @Column({ name: 'department_service_id', type: 'uuid', nullable: true })
  department_service_id: string | null;

  @ManyToOne(() => DepartmentService, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'department_service_id' })
  department_service: DepartmentService | null;

  // 8. Rad etish sababi (agar ariza rad etilgan bo'lsa)
  @Column({ name: 'rejection_reason_id', type: 'uuid', nullable: true })
  rejection_reason_id: string | null;

  @ManyToOne(() => RejectionReason, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'rejection_reason_id' })
  rejection_reason: RejectionReason | null;

  // 9. Yakuniy qaror turi (JI qo'zg'atilgan, boshqa ishga qo'shilgan, va h.k.)
  @Column({ name: 'decision_type_id', type: 'uuid', nullable: true })
  decision_type_id: string | null;

  @ManyToOne(() => DecisionType, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'decision_type_id' })
  decision_type: DecisionType | null;

  // 9.1. Arizachining ariza paytidagi ish joyi / tashkiloti va lavozimi (Snapshot)
  @Column({ name: 'workplace_id', type: 'uuid', nullable: true })
  workplace_id: string | null;

  @ManyToOne(() => Workplace, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'workplace_id' })
  workplace: Workplace | null;

  @Column({ name: 'work_position', type: 'varchar', length: 200, nullable: true })
  work_position: string | null;

  // 10. Arizani yaratgan xodim (Audit & RBAC)
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  created_by_id: string | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'created_by_id' })
  created_by: User | null;

  // 11. Soft Delete (O'chirilganlik holati va audit metadata)
  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ name: 'deleted_at', type: 'timestamp with time zone', nullable: true })
  deleted_at: Date | null;

  @Column({ name: 'deleted_by_id', type: 'uuid', nullable: true })
  deleted_by_id: string | null;

  // 12. Arizaga biriktirilgan va yaratilgan Word hujjatlar
  @OneToMany(() => ApplicationDocument, (doc: ApplicationDocument) => doc.application)
  documents: ApplicationDocument[];

  // 13. Ariza kiritilgan tashqi axborot tizimlari (CardBlock, E-Elektron, ...)
  @OneToMany(() => ApplicationExternalSystem, (aes) => aes.application)
  external_systems: ApplicationExternalSystem[];

  // 14. Ro'yxatda tezkor vizual belgilash rangi (real-vaqt sinxronizatsiyali)
  @Column({ name: 'row_color', type: 'varchar', length: 20, nullable: true })
  row_color: string | null;

  @Column({ name: 'row_color_by', type: 'varchar', length: 120, nullable: true })
  row_color_by: string | null;

  @Column({ name: 'row_color_updated_at', type: 'timestamp with time zone', nullable: true })
  row_color_updated_at: Date | null;

  /**
   * Tahliliy bog'liqliklar hisoboti (Virtual/Hisoblangan maydon)
   */
  relations_summary?: {
    total: number;
    cards: number;
    citizens: number;
    suspects?: number;
    has_fraud_card_link: boolean;
  };

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields(): void {
    if (this.application_number) {
      this.application_number = this.application_number.trim() || null;
    }
  }
}
