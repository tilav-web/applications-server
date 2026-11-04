import { Column, Entity, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';
import type { Transfer } from '../transfer.entity';

@Entity('payment_providers')
export class PaymentProvider extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 100, nullable: true })
  name: string | null;

  @Column({
    name: 'code',
    type: 'varchar',
    length: 50,
    unique: true,
    nullable: true,
  })
  code: string | null;

  @OneToMany('Transfer', 'payment_provider')
  transfers: Transfer[];
}
