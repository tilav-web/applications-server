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

import { BaseEntity } from '../../../../common/database/base.entity';
import type { Application } from '../../application.entity';
import { Citizen } from '../../citizens/citizen.entity';
import { Bank } from '../banks/bank.entity';
import type { Transfer } from '../transfer.entity';

@Entity('cards')
@Index('UQ_cards_card_number_not_null', ['card_number'], {
  unique: true,
  where: '"card_number" IS NOT NULL AND "card_number" <> \'\'',
})
@Index('IDX_cards_citizen_id', ['citizen_id'])
@Index('IDX_cards_bank_id', ['bank_id'])
export class Card extends BaseEntity {
  @Column({
    name: 'card_number',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  card_number: string | null;

  @Column({
    name: 'masked_number',
    type: 'varchar',
    length: 25,
    nullable: true,
  })
  masked_number: string | null;

  @Column({
    name: 'expire_date',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  expire_date: string | null;

  @Column({
    name: 'full_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  full_name: string | null;

  // 1. Karta egasi (Fuqaro / Citizen modeli bilan bog'lanish)
  @Column({ name: 'citizen_id', type: 'uuid', nullable: true })
  citizen_id: string | null;

  @ManyToOne(() => Citizen, (citizen) => citizen.cards, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen | null;

  // 2. Bank modeli bilan bog'lanish
  @Column({ name: 'bank_id', type: 'uuid', nullable: true })
  bank_id: string | null;

  @ManyToOne(() => Bank, (bank) => bank.cards, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'bank_id' })
  bank: Bank | null;

  // 3. O'tkazmalar
  @OneToMany('Transfer', 'card')
  transfers: Transfer[];

  // 4. Arizalar bilan bog'lanish (bitta karta bir nechta arizaga asosiy karta bo'lib ulanishi mumkin)
  @OneToMany('Application', 'card')
  applications: Application[];

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields(): void {
    if (this.card_number) {
      // Bo'shliqlar va chiziqchalarni olib tashlaymiz
      const cleaned = this.card_number.replace(/\D/g, '');
      this.card_number = cleaned;

      // Agar niqoblangan raqam ko'rsatilmagan bo'lsa va raqam uzunligi 16 bo'lsa, avtomatik yaratamiz (masalan: 8600 **** **** 1290)
      if (!this.masked_number && cleaned.length === 16) {
        this.masked_number = `${cleaned.substring(0, 4)} **** **** ${cleaned.substring(12, 16)}`;
      }
    }
  }
}
