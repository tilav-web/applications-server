import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Citizen } from '../citizens/citizen.entity';
import { District } from '../districts/district.entity';

@Entity('mahallas')
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

  @ManyToOne(() => District, (district) => district.mahallas, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @OneToMany('Citizen', 'mahalla')
  citizens: Citizen[];
}
