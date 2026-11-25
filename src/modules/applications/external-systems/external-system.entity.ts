import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

/**
 * Arizalar kiritilishi kerak bo'lgan tashqi axborot tizimlari master-jadvali.
 * Ma'lumotnomalar sahifasidan boshqariladi (masalan: CardBlock, E-Elektron, E-Material, CyberControl).
 */
@Entity('external_systems')
export class ExternalSystem extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 150, unique: true })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 60, unique: true, nullable: true })
  code: string | null;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'color', type: 'varchar', length: 30, nullable: true, default: '#2563EB' })
  color: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
