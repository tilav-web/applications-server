import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/database/base.entity';
import { User } from '../users/user.entity';
import type { Application } from './application.entity';
import { ApplicationStatus } from './statuses/application-status.entity';

export type StatusHistoryAction =
  'CREATED' | 'STATUS_CHANGED' | 'DEADLINE_EXTENDED' | 'DEADLINE_CHANGED' | 'CLOSED';

@Entity('application_status_history')
@Index('IDX_app_status_history_app_created', ['application_id', 'created_at'])
export class ApplicationStatusHistory extends BaseEntity {
  @Column({ name: 'application_id', type: 'uuid' })
  application_id: string;

  @ManyToOne('Application', 'status_history', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ name: 'action', type: 'varchar', length: 40, default: 'STATUS_CHANGED' })
  action: StatusHistoryAction;

  @Column({ name: 'from_status_id', type: 'uuid', nullable: true })
  from_status_id: string | null;

  @ManyToOne(() => ApplicationStatus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'from_status_id' })
  from_status: ApplicationStatus | null;

  @Column({ name: 'from_status_name', type: 'varchar', length: 120, nullable: true })
  from_status_name: string | null;

  @Column({ name: 'to_status_id', type: 'uuid', nullable: true })
  to_status_id: string | null;

  @ManyToOne(() => ApplicationStatus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'to_status_id' })
  to_status: ApplicationStatus | null;

  @Column({ name: 'to_status_name', type: 'varchar', length: 120, nullable: true })
  to_status_name: string | null;

  @Column({ name: 'old_deadline_at', type: 'timestamp with time zone', nullable: true })
  old_deadline_at: Date | null;

  @Column({ name: 'new_deadline_at', type: 'timestamp with time zone', nullable: true })
  new_deadline_at: Date | null;

  @Column({ name: 'prosecutor_approval_number', type: 'varchar', length: 120, nullable: true })
  prosecutor_approval_number: string | null;

  @Column({ name: 'prosecutor_approval_date', type: 'timestamp with time zone', nullable: true })
  prosecutor_approval_date: Date | null;

  @Column({ name: 'decision_type_name', type: 'varchar', length: 255, nullable: true })
  decision_type_name: string | null;

  @Column({ name: 'decision_number', type: 'varchar', length: 120, nullable: true })
  decision_number: string | null;

  @Column({ name: 'decision_date', type: 'timestamp with time zone', nullable: true })
  decision_date: Date | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'changed_by_id', type: 'uuid', nullable: true })
  changed_by_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by_id' })
  changed_by: User | null;
}
