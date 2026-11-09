import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';

@Entity('document_templates')
export class DocumentTemplate extends BaseEntity {
  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'title_krill', type: 'varchar', length: 255, nullable: true })
  title_krill: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'category',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  category: string | null;

  @Column({ name: 'file_key', type: 'varchar', length: 500 })
  file_key: string;

  @Column({ name: 'file_key_krill', type: 'varchar', length: 500, nullable: true })
  file_key_krill: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  file_name: string;

  @Column({ name: 'file_size', type: 'bigint', default: 0 })
  file_size: number;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'doc_key', type: 'varchar', length: 100, nullable: true })
  doc_key: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;

  @Column({
    name: 'available_tags',
    type: 'jsonb',
    default: () => "'[]'",
  })
  available_tags: string[];

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  created_by_id: string | null;
}

