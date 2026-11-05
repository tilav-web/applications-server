import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import type { Application } from '../application.entity';
import { District } from '../districts/district.entity';
import { Mahalla } from '../mahallas/mahalla.entity';
import type { Card } from '../transfers/cards/card.entity';

@Entity('citizens')
export class Citizen extends BaseEntity {
  @Column({
    name: 'first_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  first_name: string | null;

  @Column({
    name: 'last_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  last_name: string | null;

  @Column({
    name: 'middle_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  middle_name: string | null;

  @Column({
    name: 'passport',
    type: 'varchar',
    length: 9,
    nullable: true,
  })
  passport: string | null;

  @Column({
    name: 'pinfl',
    type: 'varchar',
    length: 14,
    nullable: true,
  })
  pinfl: string | null;

  @Column({
    name: 'phone_number',
    type: 'varchar',
    length: 12,
    nullable: true,
  })
  phone_number: string | null;

  @Column({
    name: 'address',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  address: string | null;

  @Column({
    name: 'district_id',
    type: 'uuid',
    nullable: true,
  })
  district_id: string | null;

  @ManyToOne(() => District, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'district_id' })
  district: District | null;

  @Column({
    name: 'mahalla_id',
    type: 'uuid',
    nullable: true,
  })
  mahalla_id: string | null;

  @ManyToOne(() => Mahalla, (mahalla) => mahalla.citizens, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'mahalla_id' })
  mahalla: Mahalla | null;

  @OneToMany('Application', 'citizen')
  applications: Application[];

  @OneToMany('Card', 'citizen')
  cards: Card[];

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields(): void {
    // 1. Telefon raqami: faqat raqamlar, '+' belgisisiz va 998XXXXXXXXX (12 ta raqam) formatda
    if (this.phone_number) {
      let cleaned = this.phone_number.replace(/\D/g, '');
      if (cleaned.length === 9) {
        cleaned = `998${cleaned}`;
      }
      this.phone_number = cleaned;
    }

    // 2. Pasport: AC1234567 ko'rinishida, boshidagi 2 ta harf KATTA va bo'shliqlarsiz
    if (this.passport) {
      const cleaned = this.passport.replace(/\s+/g, '').toUpperCase();
      this.passport = cleaned.length > 0 ? cleaned : null;
    } else {
      this.passport = null;
    }

    // 3. PINFL (JShShIR)
    if (this.pinfl) {
      const cleaned = this.pinfl.replace(/\D/g, '');
      this.pinfl = cleaned.length > 0 ? cleaned : null;
    } else {
      this.pinfl = null;
    }
  }
}
