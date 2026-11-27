import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { CustomFieldType } from '../../../common/enums/custom-field-type.enum';
import type { Application } from '../application.entity';
import { Citizen } from '../citizens/citizen.entity';
import { Crime } from '../crimes/crime.entity';
import { District } from '../districts/district.entity';
import { Card } from '../transfers/cards/card.entity';
import { Transfer } from '../transfers/transfer.entity';

@Entity('application_custom_fields')
@Index('IDX_app_custom_fields_application_id', ['application_id'])
@Index('IDX_app_custom_fields_citizen_id', ['citizen_id'])
@Index('IDX_app_custom_fields_card_id', ['card_id'])
@Index('IDX_app_custom_fields_transfer_id', ['transfer_id'])
@Index('IDX_app_custom_fields_type', ['type'])
export class ApplicationCustomField extends BaseEntity {
  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  application_id: string | null;

  @ManyToOne('Application', 'custom_fields', {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'application_id' })
  application: Application | null;

  // Foydalanuvchi/Xodim kiritgan maydon sarlavhasi (masalan: "Isbot uchun rasmlar", "Gumonlanuvchi fuqaro")
  @Column({ name: 'label', type: 'varchar', length: 255, nullable: true })
  label: string | null;

  // Tizim kaliti / slug (masalan: "isbot_uchun_rasmlar")
  @Column({ name: 'key', type: 'varchar', length: 100, nullable: true })
  key: string | null;

  // Qo'shimcha fuqaro/kartaning aniq protsessual roli: SUSPECT | DROPPER | TRANSIT | WITNESS | VICTIM | RELATED
  @Column({ name: 'entity_role', type: 'varchar', length: 30, nullable: true })
  entity_role: string | null;

  // Maydon turi: STRING, IMAGES, FILES, NUMBER, BOOLEAN, CITIZEN, CARD, TRANSFER, CRIME, DISTRICT
  @Column({
    name: 'type',
    type: 'enum',
    enum: CustomFieldType,
    default: CustomFieldType.STRING,
    nullable: true,
  })
  type: CustomFieldType | null;

  // Universal qiymat: string, number, boolean, sana yoki massiv (masalan: ["img1.png", "img2.png"])
  @Column({ name: 'value', type: 'jsonb', nullable: true })
  value: unknown;

  // ==========================================================================
  // ALOQADOR MODELLAR (Sub-models: Agar custom field sub-modelga bog'lansa)
  // ==========================================================================

  // 1. Fuqaro (Masalan: Gumonlanuvchi, Guvoh, 2-Jabrlanuvchi)
  @Column({ name: 'citizen_id', type: 'uuid', nullable: true })
  citizen_id: string | null;

  @ManyToOne(() => Citizen, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen | null;

  // 2. Plastik karta (Masalan: Gumonlanuvchi kartasi, Tranzit karta)
  @Column({ name: 'card_id', type: 'uuid', nullable: true })
  card_id: string | null;

  @ManyToOne(() => Card, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'card_id' })
  card: Card | null;

  // 3. Jinoyat moddasi (Masalan: Qo'shimcha moddalar)
  @Column({ name: 'crime_id', type: 'uuid', nullable: true })
  crime_id: string | null;

  @ManyToOne(() => Crime, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'crime_id' })
  crime: Crime | null;

  // 4. Tuman / Bo'lim
  @Column({ name: 'district_id', type: 'uuid', nullable: true })
  district_id: string | null;

  @ManyToOne(() => District, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'district_id' })
  district: District | null;

  // 5. Qo'shimcha Pul o'tkazmasi (2-tranzaksiya, 3-tranzaksiya)
  @Column({ name: 'transfer_id', type: 'uuid', nullable: true })
  transfer_id: string | null;

  @ManyToOne(() => Transfer, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'transfer_id' })
  transfer: Transfer | null;

  // UI dagi tartib raqami
  @Column({ name: 'order', type: 'int', default: 0, nullable: true })
  order: number | null;
}
