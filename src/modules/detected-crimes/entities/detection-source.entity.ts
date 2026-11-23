import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

@Entity('detection_sources')
export class DetectionSource extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 200, unique: true })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 60, nullable: true })
  code: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
