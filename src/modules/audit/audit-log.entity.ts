import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
@Index(['created_at'])
@Index(['user_id', 'created_at'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  username!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  role!: string | null;

  @Column({ type: 'varchar', length: 16 })
  method!: string;

  @Column({ type: 'varchar', length: 512 })
  path!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  user_agent!: string | null;

  @Column({ type: 'int', default: 200 })
  status_code!: number;

  @Column({ type: 'int', default: 0 })
  duration_ms!: number;

  @CreateDateColumn()
  created_at!: Date;
}
