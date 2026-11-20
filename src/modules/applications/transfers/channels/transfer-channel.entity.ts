import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';
import { TransferDestinationType } from '../../../../common/enums/transfer-destination-type.enum';

@Entity('transfer_channels')
export class TransferChannel extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 60, unique: true })
  code: string;

  @Column({
    name: 'category',
    type: 'varchar',
    length: 30,
    default: TransferDestinationType.PLATFORM,
  })
  category: TransferDestinationType;

  @Column({ name: 'color', type: 'varchar', length: 30, default: '#0891b2' })
  color: string;

  @Column({ name: 'icon', type: 'varchar', length: 30, default: '🌐' })
  icon: string;

  @Column({ name: 'presets', type: 'jsonb', default: () => "'[]'" })
  presets: string[];

  @Column({ name: 'platform_label', type: 'varchar', length: 150, nullable: true })
  platform_label: string | null;

  @Column({ name: 'platform_placeholder', type: 'varchar', length: 200, nullable: true })
  platform_placeholder: string | null;

  @Column({ name: 'value_label', type: 'varchar', length: 150, nullable: true })
  value_label: string | null;

  @Column({ name: 'value_placeholder', type: 'varchar', length: 200, nullable: true })
  value_placeholder: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 10 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
