import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

@Entity('detected_crime_statuses')
export class DetectedCrimeStatus extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 150, unique: true })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 60, unique: true })
  code: string;

  @Column({ name: 'color', type: 'varchar', length: 30, default: 'rose' })
  color: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  is_default: boolean;

  @Column({ name: 'is_final', type: 'boolean', default: false })
  is_final: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
