import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '../../common/database/base.entity';
import { ApplicationStatus } from '../../common/enums/application-status.enum';
import { Citizen } from './citizens/citizen.entity';
import { Crime } from './crimes/crime.entity';
import { ApplicationCustomField } from './custom-fields/application-custom-field.entity';
import { District } from './districts/district.entity';
import { Card } from './transfers/cards/card.entity';
import { Transfer } from './transfers/transfer.entity';

@Entity('applications')
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

  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.YANGI,
    name: 'status',
    nullable: true,
  })
  status: ApplicationStatus | null;

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

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields(): void {
    if (this.application_number) {
      this.application_number = this.application_number.trim() || null;
    }
  }
}
