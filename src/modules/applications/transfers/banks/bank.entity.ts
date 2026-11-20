import { Column, Entity, Index, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';
import type { Card } from '../cards/card.entity';

@Entity('banks')
@Index('UQ_banks_name_not_null', ['name'], {
  unique: true,
  where: '"name" IS NOT NULL AND "name" <> \'\'',
})
@Index('UQ_banks_mfo_not_null', ['mfo'], {
  unique: true,
  where: '"mfo" IS NOT NULL AND "mfo" <> \'\'',
})
export class Bank extends BaseEntity {
  @Column({
    name: 'name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  name: string | null;

  @Column({
    name: 'code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  code: string | null;

  @Column({
    name: 'mfo',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  mfo: string | null;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    nullable: true,
  })
  is_active: boolean | null;

  @OneToMany('Card', 'bank')
  cards: Card[];
}
