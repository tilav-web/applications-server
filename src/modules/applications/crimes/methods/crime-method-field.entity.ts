import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';
import type { CrimeMethod } from './crime-method.entity';

export type CrimeMethodFieldType =
  'STRING' | 'NUMBER' | 'URL' | 'DATE' | 'PHONE' | 'TEXT' | 'SELECT';

@Entity('crime_method_fields')
@Index('IDX_crime_method_fields_method_id', ['crime_method_id'])
@Index('UQ_crime_method_fields_method_key', ['crime_method_id', 'key'], { unique: true })
export class CrimeMethodField extends BaseEntity {
  @Column({ name: 'crime_method_id', type: 'uuid' })
  crime_method_id: string;

  @ManyToOne('CrimeMethod', 'fields', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'crime_method_id' })
  crime_method: CrimeMethod;

  @Column({ name: 'key', type: 'varchar', length: 100 })
  key: string;

  @Column({ name: 'label', type: 'varchar', length: 150 })
  label: string;

  @Column({ name: 'field_type', type: 'varchar', length: 30, default: 'STRING' })
  field_type: CrimeMethodFieldType;

  @Column({ name: 'options', type: 'jsonb', nullable: true })
  options: string[] | null;

  @Column({ name: 'placeholder', type: 'varchar', length: 255, nullable: true })
  placeholder: string | null;

  @Column({ name: 'is_required', type: 'boolean', default: false })
  is_required: boolean;

  @Column({ name: 'show_in_excel', type: 'boolean', default: true })
  show_in_excel: boolean;

  @Column({ name: 'excel_header', type: 'varchar', length: 150, nullable: true })
  excel_header: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
