import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';
import type { Application } from '../../application.entity';

@Entity('crime_methods')
export class CrimeMethod extends BaseEntity {
  @Column({
    name: 'name',
    type: 'text',
    unique: true,
  })
  name: string;

  @Column({
    name: 'group_name',
    type: 'varchar',
    length: 150,
    default: 'Boshqa',
  })
  group_name: string;

  @Column({
    name: 'code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  code: string | null;

  @Column({
    name: 'description',
    type: 'text',
    nullable: true,
  })
  description: string | null;

  @Column({
    name: 'sort_order',
    type: 'int',
    default: 0,
  })
  sort_order: number;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
  })
  is_active: boolean;

  @OneToMany('Application', 'crime_method')
  applications: Application[];
}
