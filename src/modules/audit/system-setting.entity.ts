import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_settings')
export class SystemSetting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 500 })
  value!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at!: Date;
}
