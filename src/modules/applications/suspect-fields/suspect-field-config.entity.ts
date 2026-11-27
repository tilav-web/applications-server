import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

@Entity('suspect_field_configs')
export class SuspectFieldConfig extends BaseEntity {
  @Column({
    name: 'key',
    type: 'varchar',
    length: 100,
    unique: true,
  })
  key: string;

  @Column({
    name: 'label',
    type: 'varchar',
    length: 150,
  })
  label: string;

  @Column({
    name: 'category',
    type: 'varchar',
    length: 100,
    default: 'Umumiy',
    nullable: true,
  })
  category: string | null;

  @Column({
    name: 'icon',
    type: 'varchar',
    length: 50,
    nullable: true,
    default: 'Hash',
  })
  icon: string | null;

  @Column({
    name: 'description',
    type: 'text',
    nullable: true,
  })
  description: string | null;

  @Column({
    name: 'sample_value',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  sample_value: string | null;

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

  @Column({
    name: 'is_linkable',
    type: 'boolean',
    default: true,
  })
  is_linkable: boolean;
}
