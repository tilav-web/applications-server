import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Citizen } from '../citizens/citizen.entity';
import { District } from '../districts/district.entity';

@Entity('neighborhoods')
@Index('IDX_neighborhoods_district_id', ['district_id'])
@Index('UQ_neighborhoods_district_name', ['district_id', 'name'], { unique: true })
export class Neighborhood extends BaseEntity {
  @Column({
    name: 'name',
    type: 'varchar',
    length: 150,
    nullable: false,
  })
  name: string;

  @Column({
    name: 'district_id',
    type: 'uuid',
    nullable: false,
  })
  district_id: string;

  @Column({
    name: 'tracking_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  tracking_id?: string | null;

  @Column({
    name: 'latitude',
    type: 'double precision',
    nullable: true,
  })
  latitude: number | null;

  @Column({
    name: 'longitude',
    type: 'double precision',
    nullable: true,
  })
  longitude: number | null;

  @ManyToOne(() => District, (district) => district.neighborhoods, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @OneToMany('Citizen', 'neighborhood')
  citizens: Citizen[];
}
