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
import type { DigitalIdentifierEntity } from '../../intelligence/entities/digital-identifier.entity';
import type { PhoneEntity } from '../../intelligence/entities/phone.entity';
import type { Application } from '../application.entity';
import { District } from '../districts/district.entity';
import { Mahalla } from '../mahallas/mahalla.entity';
import { Occupation } from '../occupations/occupation.entity';
import { OccupationCategory } from '../occupations/occupation-category.entity';
import type { Card } from '../transfers/cards/card.entity';

@Entity('citizens')
@Index('UQ_citizens_passport_not_null', ['passport'], {
  unique: true,
  where: '"passport" IS NOT NULL AND "passport" <> \'\'',
})
@Index('UQ_citizens_pinfl_not_null', ['pinfl'], {
  unique: true,
  where: '"pinfl" IS NOT NULL AND "pinfl" <> \'\'',
})
@Index('IDX_citizens_phone_number', ['phone_number'])
@Index('IDX_citizens_district_id', ['district_id'])
@Index('IDX_citizens_mahalla_id', ['mahalla_id'])
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
    name: 'birth_date',
    type: 'date',
    nullable: true,
  })
  birth_date: string | null;

  @Column({
    name: 'gender',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  gender: 'male' | 'female' | null;

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

  @Column({
    name: 'occupation_category_id',
    type: 'uuid',
    nullable: true,
  })
  occupation_category_id: string | null;

  @ManyToOne(() => OccupationCategory, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'occupation_category_id' })
  occupation_category: OccupationCategory | null;

  @Column({
    name: 'occupation_id',
    type: 'uuid',
    nullable: true,
  })
  occupation_id: string | null;

  @ManyToOne(() => Occupation, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'occupation_id' })
  occupation: Occupation | null;

  @OneToMany('Application', 'citizen')
  applications: Application[];

  @OneToMany('Card', 'citizen')
  cards: Card[];

  @OneToMany('PhoneEntity', 'citizen')
  phones: PhoneEntity[];

  @OneToMany('DigitalIdentifierEntity', 'citizen')
  digital_identifiers: DigitalIdentifierEntity[];

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
