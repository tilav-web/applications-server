import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';
import { TransferCustomFieldType } from '../../../../common/enums/transfer-custom-field-type.enum';
import { Citizen } from '../../citizens/citizen.entity';
import { Bank } from '../banks/bank.entity';
import { Card } from '../cards/card.entity';
import { PaymentProvider } from '../payment_providers/payment_provider.entity';
import type { Transfer } from '../transfer.entity';

@Entity('transfer_custom_fields')
export class TransferCustomField extends BaseEntity {
  @Column({ name: 'transfer_id', type: 'uuid', nullable: true })
  transfer_id: string | null;

  @ManyToOne('Transfer', 'custom_fields', {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'transfer_id' })
  transfer: Transfer | null;

  // Foydalanuvchi/Xodim kiritgan maydon sarlavhasi (masalan: "Chek rasmi", "Kvitansiya", "Terminal kodi")
  @Column({ name: 'label', type: 'varchar', length: 255, nullable: true })
  label: string | null;

  // Tizim kaliti / slug (masalan: "chek_rasmi", "terminal_kodi")
  @Column({ name: 'key', type: 'varchar', length: 100, nullable: true })
  key: string | null;

  // Maydon turi: TransferCustomFieldType (IMAGES, FILES, STRING, NUMBER, CARD, CITIZEN, BANK, PAYMENT_PROVIDER)
  @Column({
    name: 'type',
    type: 'enum',
    enum: TransferCustomFieldType,
    default: TransferCustomFieldType.STRING,
    nullable: true,
  })
  type: TransferCustomFieldType | null;

  // Universal qiymat: string, number, boolean, sana yoki massiv (masalan: ["check.jpg", "receipt.pdf"])
  @Column({ name: 'value', type: 'jsonb', nullable: true })
  value: unknown;

  // ==========================================================================
  // ALOQADOR MODELLAR (Sub-models: Karta, Fuqaro, Bank, To'lov provayderi)
  // ==========================================================================

  // 1. Karta (Qo'shimcha / Tranzit karta)
  @Column({ name: 'card_id', type: 'uuid', nullable: true })
  card_id: string | null;

  @ManyToOne(() => Card, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'card_id' })
  card: Card | null;

  // 2. Fuqaro (O'tkazmaga aloqador shaxs: firibgar, vositachi)
  @Column({ name: 'citizen_id', type: 'uuid', nullable: true })
  citizen_id: string | null;

  @ManyToOne(() => Citizen, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen | null;

  // 3. Bank (Vositachi bank, emitent bank)
  @Column({ name: 'bank_id', type: 'uuid', nullable: true })
  bank_id: string | null;

  @ManyToOne(() => Bank, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'bank_id' })
  bank: Bank | null;

  // 4. To'lov provayderi (Qo'shimcha xizmat / agregator)
  @Column({ name: 'payment_provider_id', type: 'uuid', nullable: true })
  payment_provider_id: string | null;

  @ManyToOne(() => PaymentProvider, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'payment_provider_id' })
  payment_provider: PaymentProvider | null;

  // UI dagi tartib raqami
  @Column({ name: 'order', type: 'int', default: 0, nullable: true })
  order: number | null;
}
