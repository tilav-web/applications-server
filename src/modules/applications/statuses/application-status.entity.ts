import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Application } from '../application.entity';

export enum ApplicationStatusCategory {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  EXTENDED = 'EXTENDED',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}

@Entity('application_statuses')
export class ApplicationStatus extends BaseEntity {
  @Column({
    name: 'name',
    type: 'varchar',
    length: 120,
    unique: true,
  })
  name: string;

  @Column({
    name: 'code',
    type: 'varchar',
    length: 60,
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
    name: 'category',
    type: 'varchar',
    length: 30,
    default: ApplicationStatusCategory.OPEN,
  })
  category: ApplicationStatusCategory;

  @Column({
    name: 'tracks_sla',
    type: 'boolean',
    default: true,
  })
  tracks_sla: boolean;

  @Column({
    name: 'default_sla_days',
    type: 'int',
    nullable: true,
    default: 10,
  })
  default_sla_days: number | null;

  @Column({
    name: 'legal_article',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  legal_article: string | null;

  @Column({
    name: 'requires_decision',
    type: 'boolean',
    default: false,
  })
  requires_decision: boolean;

  @Column({
    name: 'requires_rejection_reason',
    type: 'boolean',
    default: false,
  })
  requires_rejection_reason: boolean;

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
