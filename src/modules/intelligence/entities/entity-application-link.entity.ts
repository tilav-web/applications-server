import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { Application } from '../../applications/application.entity';
import { Citizen } from '../../applications/citizens/citizen.entity';
import { Card } from '../../applications/transfers/cards/card.entity';
import { DigitalIdentifierEntity } from './digital-identifier.entity';
import { PhoneEntity } from './phone.entity';

export type EntityLinkRole = 'VICTIM' | 'SUSPECT' | 'DROPPER' | 'TRANSIT' | 'WITNESS' | 'RELATED';

export type EntityLinkSource = 'AUTO_SYNC' | 'MANUAL_OFFICER' | 'CONFIRMED_MATCH';

@Entity('entity_application_links')
@Index(['application_id', 'role'])
@Index('UQ_entity_links_app_citizen_only_role', ['application_id', 'citizen_id', 'role'], {
  unique: true,
  where:
    '"citizen_id" IS NOT NULL AND "card_id" IS NULL AND "phone_id" IS NULL AND "identifier_id" IS NULL',
})
@Index('UQ_entity_links_app_card_role', ['application_id', 'card_id', 'role'], {
  unique: true,
  where: '"card_id" IS NOT NULL',
})
@Index('UQ_entity_links_app_phone_role', ['application_id', 'phone_id', 'role'], {
  unique: true,
  where: '"phone_id" IS NOT NULL',
})
@Index('UQ_entity_links_app_identifier_role', ['application_id', 'identifier_id', 'role'], {
  unique: true,
  where: '"identifier_id" IS NOT NULL',
})
export class EntityApplicationLink extends BaseEntity {
  @Column({ name: 'application_id', type: 'uuid' })
  application_id: string;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Index()
  @Column({ name: 'citizen_id', type: 'uuid', nullable: true })
  citizen_id: string | null;

  @ManyToOne(() => Citizen, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen | null;

  @Index()
  @Column({ name: 'card_id', type: 'uuid', nullable: true })
  card_id: string | null;

  @ManyToOne(() => Card, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id' })
  card: Card | null;

  @Index()
  @Column({ name: 'phone_id', type: 'uuid', nullable: true })
  phone_id: string | null;

  @ManyToOne(() => PhoneEntity, (p) => p.application_links, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'phone_id' })
  phone: PhoneEntity | null;

  @Index()
  @Column({ name: 'identifier_id', type: 'uuid', nullable: true })
  identifier_id: string | null;

  @ManyToOne(() => DigitalIdentifierEntity, (d) => d.application_links, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'identifier_id' })
  identifier: DigitalIdentifierEntity | null;

  @Column({ name: 'role', type: 'varchar', length: 30, default: 'RELATED' })
  role: EntityLinkRole;

  @Column({ name: 'source', type: 'varchar', length: 30, default: 'AUTO_SYNC' })
  source: EntityLinkSource;

  @Column({ name: 'note', type: 'varchar', length: 255, nullable: true })
  note: string | null;
}
