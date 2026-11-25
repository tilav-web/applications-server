import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';

/**
 * Fuqaro kiberxavfsizlik bo'yicha targ'ibot qilinganligi holati master-jadvali.
 * Masalan:
 * - Qilinmagan (is_informed = false)
 * - IIB targ'ibot qilgan, bilmasdan bosgan yoki tashlab bergan (is_informed = true, source_channel = 'IIB')
 * - Onlayn targ'ibot tanishgan, farzandi bosib qo'ygan (is_informed = true, source_channel = 'Onlayn')
 */
@Entity('awareness_statuses')
export class AwarenessStatus extends BaseEntity {
  @Column({ name: 'name', type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 60, unique: true, nullable: true })
  code: string | null;

  /** false = Qilinmagan, true = Targ'ibot qilingan */
  @Column({ name: 'is_informed', type: 'boolean', default: true })
  is_informed: boolean;

  /** Tahlil kanali: masalan 'IIB', 'Onlayn', 'Boshqa' */
  @Column({ name: 'source_channel', type: 'varchar', length: 80, nullable: true })
  source_channel: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;
}
