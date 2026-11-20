import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { TransferStatus } from '../../../common/enums/transfer-status.enum';
import type { Application } from '../application.entity';
import { Card } from './cards/card.entity';
import { TransferCustomField } from './custom-fields/transfer-custom-field.entity';
import { PaymentProvider } from './payment_providers/payment_provider.entity';

@Entity('transfers')
@Index('IDX_transfers_application_id', ['application_id'])
@Index('IDX_transfers_sender_card_id', ['sender_card_id'])
@Index('IDX_transfers_receiver_card_id', ['receiver_card_id'])
@Index('IDX_transfers_card_id', ['card_id'])
@Index('IDX_transfers_payment_provider_id', ['payment_provider_id'])
@Index('IDX_transfers_transfer_at', ['transfer_at'])
export class Transfer extends BaseEntity {
  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 100,
    unique: true,
    nullable: true,
  })
  transaction_id: string | null;

  @Column({
    name: 'amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  amount: number | null;

  @Column({
    name: 'currency',
    type: 'varchar',
    length: 10,
    default: 'UZS',
    nullable: true,
  })
  currency: string | null;

  @Column({
    type: 'enum',
    enum: TransferStatus,
    default: TransferStatus.KUTILMOQDA,
    name: 'status',
    nullable: true,
  })
  status: TransferStatus | null;

  @Column({
    name: 'transfer_date',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  transfer_date: string | null;

  @Column({
    name: 'transfer_time',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  transfer_time: string | null;

  /**
   * Indekslangan aniq tranzaksiya vaqti (transfer_date + transfer_time dan avtomatik hisoblanadi)
   */
  @Column({
    name: 'transfer_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  transfer_at: Date | null;

  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  application_id: string | null;

  @ManyToOne('Application', {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'application_id' })
  application: Application | null;

  @OneToMany('Application', 'transfer')
  applications: Application[];

  @Column({ name: 'payment_provider_id', type: 'uuid', nullable: true })
  payment_provider_id: string | null;

  @ManyToOne(() => PaymentProvider, (p) => p.transfers, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'payment_provider_id' })
  payment_provider: PaymentProvider | null;

  // 1. Jo'natuvchi karta (Pul yechilgan karta - masalan: jabrlanuvchining kartasi)
  @Column({ name: 'sender_card_id', type: 'uuid', nullable: true })
  sender_card_id: string | null;

  @ManyToOne(() => Card, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'sender_card_id' })
  sender_card: Card | null;

  // 2. Qabul qiluvchi karta (Pul tushgan karta - masalan: firibgarning kartasi)
  @Column({ name: 'receiver_card_id', type: 'uuid', nullable: true })
  receiver_card_id: string | null;

  @ManyToOne(() => Card, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'receiver_card_id' })
  receiver_card: Card | null;

  // 3. Umumiy / zaxira karta havolasi
  @Column({ name: 'card_id', type: 'uuid', nullable: true })
  card_id: string | null;

  @ManyToOne(() => Card, (c) => c.transfers, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'card_id' })
  card: Card | null;

  // Dinamik qo'shimcha maydonlar (Chek rasmlari, fayllar, kvitansiya, qo'shimcha parametrlar)
  @OneToMany(() => TransferCustomField, (field) => field.transfer, {
    cascade: true,
  })
  custom_fields: TransferCustomField[];

  @BeforeInsert()
  @BeforeUpdate()
  syncTransferTimestamp(): void {
    if (!this.transfer_date) return;
    const rawDate = this.transfer_date.trim();
    const rawTime = (this.transfer_time || '00:00:00').trim();
    const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? `${rawDate}T${rawTime.length === 5 ? `${rawTime}:00` : rawTime}`
      : rawDate;
    const parsed = new Date(isoCandidate);
    if (!Number.isNaN(parsed.getTime())) {
      this.transfer_at = parsed;
    }
  }
}
