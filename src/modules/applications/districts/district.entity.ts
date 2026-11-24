import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Application } from '../application.entity';
import type { Neighborhood } from '../neighborhoods/neighborhood.entity';
import { Region } from '../regions/region.entity';

@Entity('districts')
@Index('IDX_districts_region_id', ['region_id'])
@Index('UQ_districts_name_not_null', ['name'], {
  unique: true,
  where: '"name" IS NOT NULL AND "name" <> \'\'',
})
export class District extends BaseEntity {
  @Column({
    name: 'name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  name: string | null;

  @Column({
    name: 'region_id',
    type: 'uuid',
    nullable: true,
  })
  region_id: string | null;

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

  @ManyToOne(() => Region, (region) => region.districts, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'region_id' })
  region: Region | null;

  @OneToMany('Application', 'district')
  applications: Application[];

  @OneToMany('Neighborhood', 'district')
  neighborhoods: Neighborhood[];
}
