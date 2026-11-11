import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

@Entity('department_services')
export class DepartmentService extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ name: 'short_name', type: 'varchar', length: 50, nullable: true })
  short_name: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
