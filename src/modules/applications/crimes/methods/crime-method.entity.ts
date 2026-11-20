import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import { BaseEntity } from '../../../../common/database/base.entity';
import type { Application } from '../../application.entity';
import { Crime } from '../crime.entity';
import { CrimeMethodField } from './crime-method-field.entity';

@Entity('crime_methods')
export class CrimeMethod extends BaseEntity {
  @Column({
    name: 'name',
    type: 'text',
    unique: true,
  })
  name: string;

  @Column({
    name: 'group_name',
    type: 'varchar',
    length: 150,
    default: 'Boshqa',
  })
  group_name: string;

  @Column({
    name: 'code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  code: string | null;

  @Column({
    name: 'description',
    type: 'text',
    nullable: true,
  })
  description: string | null;

  @Column({
    name: 'sort_order',
    type: 'int',
    default: 0,
  })
  sort_order: number;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
  })
  is_active: boolean;

  /**
   * Qaysi jinoyat turlariga (moddalarga) tegishli ekanligi.
   * Bo'sh massiv ([]) bo'lsa — UMUMIY usul (barcha jinoyat turlarida tanlash mumkin).
   */
  @ManyToMany(() => Crime, { eager: false })
  @JoinTable({
    name: 'crime_method_crimes',
    joinColumn: { name: 'crime_method_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'crime_id', referencedColumnName: 'id' },
  })
  crimes: Crime[];

  /**
   * Ushbu jinoyat usuli tanlanganda dinamik chiqadigan qo'shimcha maydonlar (APK, Telegram, va h.k.)
   */
  @OneToMany(() => CrimeMethodField, (field) => field.crime_method, {
    cascade: true,
  })
  fields: CrimeMethodField[];

  @OneToMany('Application', 'crime_method')
  applications: Application[];
}
