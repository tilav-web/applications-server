import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { User } from '../../users/user.entity';
import { Application } from '../application.entity';
import { ExternalSystem } from './external-system.entity';

/**
 * Ariza qaysi tashqi tizimlarga kiritilganligini bog'lovchi relyatsion jadval.
 */
@Entity('application_external_systems')
@Unique('uq_application_external_system', ['application_id', 'external_system_id'])
@Index('idx_app_ext_sys_app_id', ['application_id'])
@Index('idx_app_ext_sys_sys_app', ['external_system_id', 'application_id'])
export class ApplicationExternalSystem extends BaseEntity {
  @Column({ name: 'application_id', type: 'uuid' })
  application_id: string;

  @ManyToOne(() => Application, (app) => app.external_systems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ name: 'external_system_id', type: 'uuid' })
  external_system_id: string;

  @ManyToOne(() => ExternalSystem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'external_system_id' })
  external_system: ExternalSystem;

  @Column({ name: 'external_number', type: 'varchar', length: 120, nullable: true })
  external_number: string | null;

  @Column({ name: 'entered_at', type: 'timestamp with time zone', nullable: true })
  entered_at: Date | null;

  @Column({ name: 'entered_by_id', type: 'uuid', nullable: true })
  entered_by_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'entered_by_id' })
  entered_by: User | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;
}
