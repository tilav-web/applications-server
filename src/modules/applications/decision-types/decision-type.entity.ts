import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

@Entity('decision_types')
export class DecisionType extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
