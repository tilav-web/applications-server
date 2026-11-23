import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { Citizen } from '../../applications/citizens/citizen.entity';
import type { DetectedCrime } from './detected-crime.entity';

export type EvidenceType =
  | 'PHONE'
  | 'LAPTOP_PC'
  | 'SIM_CARD'
  | 'STORAGE_MEDIA'
  | 'CRYPTO_WALLET'
  | 'BANK_CARD'
  | 'SCREENSHOT_VIDEO'
  | 'DOCUMENT'
  | 'CASH'
  | 'OTHER';

@Entity('detected_crime_evidences')
@Index('IDX_dc_evidences_crime_id', ['detected_crime_id'])
export class DetectedCrimeEvidence extends BaseEntity {
  @Column({ name: 'detected_crime_id', type: 'uuid' })
  detected_crime_id: string;

  @ManyToOne('DetectedCrime', 'evidences', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'detected_crime_id' })
  detected_crime: DetectedCrime;

  @Column({ name: 'evidence_type', type: 'varchar', length: 40, default: 'OTHER' })
  evidence_type: EvidenceType;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'identifier_value', type: 'varchar', length: 255, nullable: true })
  identifier_value: string | null;

  @Column({ name: 'seized_at', type: 'timestamp with time zone', nullable: true })
  seized_at: Date | null;

  @Column({ name: 'seized_from_citizen_id', type: 'uuid', nullable: true })
  seized_from_citizen_id: string | null;

  @ManyToOne(() => Citizen, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'seized_from_citizen_id' })
  seized_from_citizen: Citizen | null;

  @Column({ name: 'file_key', type: 'varchar', length: 500, nullable: true })
  file_key: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  file_name: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;
}
