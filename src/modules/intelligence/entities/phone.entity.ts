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

import { BaseEntity } from '../../../common/database/base.entity';
import { Citizen } from '../../applications/citizens/citizen.entity';
import {
  detectMobileOperator,
  formatPhoneDisplay,
  normalizePhoneDigits,
} from '../utils/identifier-normalizer.util';
import type { EntityApplicationLink } from './entity-application-link.entity';

@Entity('phones')
export class PhoneEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'phone_number', type: 'varchar', length: 24, unique: true })
  phone_number: string;

  @Column({ name: 'formatted_number', type: 'varchar', length: 35, nullable: true })
  formatted_number: string | null;

  @Column({ name: 'operator', type: 'varchar', length: 60, nullable: true })
  operator: string | null;

  @Column({ name: 'citizen_id', type: 'uuid', nullable: true })
  citizen_id: string | null;

  @ManyToOne(() => Citizen, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen | null;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  is_primary: boolean;

  @Column({ name: 'label', type: 'varchar', length: 120, nullable: true })
  label: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @OneToMany('EntityApplicationLink', 'phone')
  application_links: EntityApplicationLink[];

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields(): void {
    const clean = normalizePhoneDigits(this.phone_number);
    this.phone_number = clean;
    this.formatted_number = formatPhoneDisplay(clean) || null;
    if (!this.operator || this.operator === 'Nomaʼlum') {
      this.operator = detectMobileOperator(clean);
    }
  }
}
