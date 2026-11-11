import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

@Entity('application_sources')
export class ApplicationSource extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 50, nullable: true })
  code: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
