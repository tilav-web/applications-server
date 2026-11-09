import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Application } from '../application.entity';

@Entity('application_documents')
export class ApplicationDocument extends BaseEntity {
  @Column({ name: 'application_id', type: 'uuid' })
  application_id: string;

  @ManyToOne('Application', 'documents', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  file_name: string;

  @Column({ name: 'file_key', type: 'varchar', length: 500 })
  file_key: string;

  @Column({ name: 'file_url', type: 'varchar', length: 1000 })
  file_url: string;

  @Column({ name: 'file_type', type: 'varchar', length: 20, default: 'docx' })
  file_type: string;

  @Column({ name: 'size', type: 'bigint', default: 0 })
  size: number;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'doc_key', type: 'varchar', length: 100, nullable: true })
  doc_key: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  created_by_id: string | null;
}

