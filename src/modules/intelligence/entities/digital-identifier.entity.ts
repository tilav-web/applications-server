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
  getIdentifierTypeLabel,
  normalizeIdentifierValue,
} from '../utils/identifier-normalizer.util';
import type { EntityApplicationLink } from './entity-application-link.entity';

@Entity('digital_identifiers')
@Index(['type', 'normalized_value'], { unique: true })
export class DigitalIdentifierEntity extends BaseEntity {
  @Column({ name: 'type', type: 'varchar', length: 60 })
  type: string;

  @Column({ name: 'type_label', type: 'varchar', length: 150, nullable: true })
  type_label: string | null;

  @Column({ name: 'raw_value', type: 'varchar', length: 255 })
  raw_value: string;

  @Index()
  @Column({ name: 'normalized_value', type: 'varchar', length: 255 })
  normalized_value: string;

  @Column({ name: 'citizen_id', type: 'uuid', nullable: true })
  citizen_id: string | null;

  @ManyToOne(() => Citizen, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @OneToMany('EntityApplicationLink', 'identifier')
  application_links: EntityApplicationLink[];

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields(): void {
    this.type = (this.type || 'other_info').trim().toLowerCase();
    this.raw_value = (this.raw_value || '').trim();
    this.normalized_value = normalizeIdentifierValue(this.type, this.raw_value);
    if (!this.type_label) {
      this.type_label = getIdentifierTypeLabel(this.type);
    }
  }
}
