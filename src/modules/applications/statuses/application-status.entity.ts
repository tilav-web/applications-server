import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Application } from '../application.entity';

@Entity('application_statuses')
export class ApplicationStatus extends BaseEntity {
  @Column({
    name: 'name',
    type: 'varchar',
    length: 100,
    unique: true,
  })
  name: string;

  @Column({
    name: 'code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  code: string | null;

  @Column({
    name: 'color',
    type: 'varchar',
    length: 50,
    default: 'blue',
    nullable: true,
  })
  color: string | null;

  @Column({
    name: 'description',
    type: 'text',
    nullable: true,
  })
  description: string | null;

  @Column({
    name: 'is_default',
    type: 'boolean',
    default: false,
  })
  is_default: boolean;

  @Column({
    name: 'sort_order',
    type: 'int',
    default: 0,
  })
  sort_order: number;

  @OneToMany('Application', 'application_status')
  applications: Application[];
}

