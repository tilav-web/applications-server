import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { OccupationCategory } from './occupation-category.entity';

@Entity('occupations')
export class Occupation extends BaseEntity {
  @Column({ name: 'category_id', type: 'uuid' })
  category_id: string;

  @ManyToOne(() => OccupationCategory, (cat) => cat.occupations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'category_id' })
  category: OccupationCategory;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 50, nullable: true })
  code: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
