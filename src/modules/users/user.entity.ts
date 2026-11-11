import { Column, Entity, JoinColumn, JoinTable, ManyToMany, OneToOne } from 'typeorm';

import { BaseEntity } from '../../common/database/base.entity';
import { District } from '../applications/districts/district.entity';
import { Auth } from '../auth/auth.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  first_name: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  last_name: string | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 30, nullable: true })
  phone_number: string | null;

  @Column({ name: 'auth_id', type: 'uuid', unique: true })
  auth_id: string;

  @OneToOne(() => Auth, (auth: Auth) => auth.user, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'auth_id' })
  auth: Auth;

  @ManyToMany(() => District, { cascade: false })
  @JoinTable({
    name: 'user_assigned_districts',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'district_id', referencedColumnName: 'id' },
  })
  assigned_districts: District[];
}
