import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { ApplicationDamageType } from '../../../common/enums/damage-type.enum';
import type { Application } from '../application.entity';
import { Bank } from '../transfers/banks/bank.entity';
import { PaymentProvider } from '../transfers/payment_providers/payment_provider.entity';

/**
 * Bank kartasidan pul yechilmasdan yetkazilgan moddiy zarar bandlari
 * (masalan: fuqaro nomiga onlayn kredit, Uzum Nasiya, Alif Nasiya, tovar/xizmat aldovi).
 * Bitta arizada 0, 1 yoki bir nechta band bo'lishi mumkin.
 */
@Entity('application_damages')
@Index('IDX_application_damages_application_id', ['application_id'])
@Index('IDX_application_damages_damage_type', ['damage_type'])
export class ApplicationDamage extends BaseEntity {
  @Column({ name: 'application_id', type: 'uuid' })
  application_id: string;

  @ManyToOne('Application', 'damages', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({
    name: 'damage_type',
    type: 'varchar',
    length: 40,
    default: ApplicationDamageType.ONLINE_CREDIT,
  })
  damage_type: ApplicationDamageType;

  /** Kredit/nasiya rasmiylashtirilgan bank, platforma yoki tashkilot nomi (masalan: Uzum Nasiya, TBC Bank) */
  @Column({ name: 'organization_name', type: 'varchar', length: 255, nullable: true })
  organization_name: string | null;

  @Column({ name: 'bank_id', type: 'uuid', nullable: true })
  bank_id: string | null;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'bank_id' })
  bank: Bank | null;

  @Column({ name: 'payment_provider_id', type: 'uuid', nullable: true })
  payment_provider_id: string | null;

  @ManyToOne(() => PaymentProvider, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_provider_id' })
  payment_provider: PaymentProvider | null;

  @Column({
    name: 'amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  amount: number;

  @Column({
    name: 'currency',
    type: 'varchar',
    length: 10,
    default: 'UZS',
  })
  currency: string;

  /** Shartnoma raqami, buyurtma ID yoki kredit raqami */
  @Column({ name: 'contract_number', type: 'varchar', length: 120, nullable: true })
  contract_number: string | null;

  /** Zarar yetkazilgan / kredit rasmiylashtirilgan sana (YYYY-MM-DD) */
  @Column({ name: 'damage_date', type: 'varchar', length: 20, nullable: true })
  damage_date: string | null;

  /** Nima xarid qilingani yoki qo'shimcha tafsilot (masalan: iPhone 15 Pro, 12 oylik nasiya) */
  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'order', type: 'int', default: 0 })
  order: number;
}
