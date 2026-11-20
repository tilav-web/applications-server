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
import { User } from '../users/user.entity';
import { Citizen } from './citizens/citizen.entity';
import { Crime } from './crimes/crime.entity';
import { CrimeMethod } from './crimes/methods/crime-method.entity';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { DecisionType } from './decision-types/decision-type.entity';
import { DepartmentService } from './department-services/department-service.entity';
import { District } from './districts/district.entity';
import { ApplicationDocument } from './documents/application-document.entity';
import { RejectionReason } from './rejection-reasons/rejection-reason.entity';
import { ApplicationSource } from './sources/application-source.entity';
import { ApplicationStatus as ApplicationStatusEntity } from './statuses/application-status.entity';
import { Card } from './transfers/cards/card.entity';
import { Transfer } from './transfers/transfer.entity';

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
  // 1. DINAMIK MAYDONLAR (Yagona dinamik massiv - Universal Custom Fields)
  // ==========================================================================
  @OneToMany(() => ApplicationCustomField, (field) => field.application, {
    cascade: true,
  })
  custom_fields: ApplicationCustomField[];

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
