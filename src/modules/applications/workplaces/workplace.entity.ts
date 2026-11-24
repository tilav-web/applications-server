import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { District } from '../districts/district.entity';
import { Neighborhood } from '../neighborhoods/neighborhood.entity';
import { Occupation } from '../occupations/occupation.entity';
import { OccupationCategory } from '../occupations/occupation-category.entity';

@Entity('workplaces')
@Index('IDX_workplaces_district_id', ['district_id'])
@Index('IDX_workplaces_neighborhood_id', ['neighborhood_id'])
@Index('IDX_workplaces_category_id', ['occupation_category_id'])
export class Workplace extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'district_id', type: 'uuid', nullable: true })
  district_id: string | null;

  @ManyToOne(() => District, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'district_id' })
  district: District | null;

  @Column({ name: 'neighborhood_id', type: 'uuid', nullable: true })
  neighborhood_id: string | null;

  @ManyToOne(() => Neighborhood, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'neighborhood_id' })
  neighborhood: Neighborhood | null;

  @Column({ name: 'occupation_category_id', type: 'uuid', nullable: true })
  occupation_category_id: string | null;

  @ManyToOne(() => OccupationCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'occupation_category_id' })
  occupation_category: OccupationCategory | null;

  @ManyToMany(() => Occupation, { cascade: false })
  @JoinTable({
    name: 'workplace_occupations',
    joinColumn: { name: 'workplace_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'occupation_id', referencedColumnName: 'id' },
  })
  occupations: Occupation[];

  @Column({ name: 'address', type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ name: 'inn', type: 'varchar', length: 20, nullable: true })
  inn: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
