import { Column, Entity, Index, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { District } from '../districts/district.entity';

@Entity('regions')
@Index('UQ_regions_name_not_null', ['name'], {
  unique: true,
  where: '"name" IS NOT NULL AND "name" <> \'\'',
})
export class Region extends BaseEntity {
  @Column({
    name: 'name',
    type: 'varchar',
    length: 150,
    nullable: false,
  })
  name: string;

  @Column({
    name: 'code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  code: string | null;

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

  @OneToMany('District', 'region')
  districts: District[];
}
