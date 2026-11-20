import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/database/base.entity';
import { User } from '../users/user.entity';

export type NotificationType =
  | 'HIGH_VALUE_ALERT'
  | 'CROSS_CASE_MATCH'
  | 'SLA_WARNING'
  | 'SLA_OVERDUE'
  | 'NEW_APPLICATION'
  | 'STATUS_CHANGED'
  | 'SECURITY_ALERT'
  | 'DAILY_DIGEST'
  | 'SYSTEM';

export type NotificationPriority = 'CRITICAL' | 'WARNING' | 'INFO';

@Entity('notifications')
@Index('IDX_notifications_user_read_created', ['user_id', 'is_read', 'created_at'])
export class Notification extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'type', type: 'varchar', length: 50, default: 'SYSTEM' })
  type: NotificationType;

  @Column({ name: 'priority', type: 'varchar', length: 20, default: 'INFO' })
  priority: NotificationPriority;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'link_url', type: 'varchar', length: 300, nullable: true })
  link_url: string | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  is_read: boolean;

  @Column({ name: 'read_at', type: 'timestamp with time zone', nullable: true })
  read_at: Date | null;

  @Column({ name: 'sent_to_telegram', type: 'boolean', default: false })
  sent_to_telegram: boolean;
}
