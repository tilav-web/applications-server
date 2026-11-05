import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Application } from '../application.entity';
import type { Mahalla } from '../mahallas/mahalla.entity';

@Entity('districts')
export class District extends BaseEntity {
  @Column({
    name: 'name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  name: string | null;

  @OneToMany('Application', 'district')
  applications: Application[];

  @OneToMany('Mahalla', 'district')
  mahallas: Mahalla[];
}
