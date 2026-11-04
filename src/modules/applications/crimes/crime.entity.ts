import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { CrimeGravity } from '../../../common/enums/crime-gravity.enum';
import type { Application } from '../application.entity';

@Entity('crimes')
export class Crime extends BaseEntity {
  @Column({
    name: 'article',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  article: string | null;

  @Column({
    name: 'title',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  title: string | null;

  @Column({
    name: 'part',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  part: string | null;

  @Column({
    name: 'category',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  category: string | null;

  @Column({
    type: 'enum',
    enum: CrimeGravity,
    default: CrimeGravity.ORTA_OGIR,
    nullable: true,
    name: 'gravity',
  })
  gravity: CrimeGravity | null;

  @Column({
    name: 'description',
    type: 'text',
    nullable: true,
  })
  description: string | null;

  @OneToMany('Application', 'crime')
  applications: Application[];
}
