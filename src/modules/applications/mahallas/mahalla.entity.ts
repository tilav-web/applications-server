import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Citizen } from '../citizens/citizen.entity';
import { District } from '../districts/district.entity';

@Entity('mahallas')
@Index('IDX_mahallas_district_id', ['district_id'])
@Index('UQ_mahallas_district_name', ['district_id', 'name'], { unique: true })
export class Mahalla extends BaseEntity {
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

  @ManyToOne(() => District, (district) => district.mahallas, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @OneToMany('Citizen', 'mahalla')
  citizens: Citizen[];
}
