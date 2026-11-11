import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { Occupation } from './occupation.entity';

@Entity('occupation_categories')
export class OccupationCategory extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 50, nullable: true })
  code: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;

  @OneToMany(() => Occupation, (occupation) => occupation.category)
  occupations: Occupation[];
}
