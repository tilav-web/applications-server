import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../../common/database/base.entity';
import { Citizen } from '../../applications/citizens/citizen.entity';
import type { DetectedCrime } from './detected-crime.entity';

export type SuspectCrimeRole =
  'TASHKILOTCHI' | 'ADMIN' | 'IJROCHI' | 'VOSITACHI' | 'KARTA_EGASI' | 'BOSHQA';

export type DetentionStatus = 'USHLANGAN' | 'QIDIRUVDA' | 'TILXATDA' | 'OZODLIKDA' | 'ANIQLANMOQDA';

@Entity('detected_crime_suspects')
@Index('IDX_dc_suspects_crime_id', ['detected_crime_id'])
@Index('IDX_dc_suspects_citizen_id', ['citizen_id'])
export class DetectedCrimeSuspect extends BaseEntity {
  @Column({ name: 'detected_crime_id', type: 'uuid' })
  detected_crime_id: string;

  @ManyToOne('DetectedCrime', 'suspects', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'detected_crime_id' })
  detected_crime: DetectedCrime;

  @Column({ name: 'citizen_id', type: 'uuid' })
  citizen_id: string;

  @ManyToOne(() => Citizen, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'citizen_id' })
  citizen: Citizen;

  @Column({ name: 'role_in_crime', type: 'varchar', length: 40, default: 'IJROCHI' })
  role_in_crime: SuspectCrimeRole;

  @Column({ name: 'detention_status', type: 'varchar', length: 40, default: 'ANIQLANMOQDA' })
  detention_status: DetentionStatus;

  @Column({ name: 'is_repeat_offender', type: 'boolean', default: false })
  is_repeat_offender: boolean;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;
}
