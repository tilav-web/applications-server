import { Column, Entity, OneToOne } from 'typeorm';

import { BaseEntity } from '../../common/database/base.entity';
import { Role } from '../../common/enums/role.enum';
import { User } from '../users/user.entity';

@Entity('auth')
export class Auth extends BaseEntity {
  @Column({ name: 'username', type: 'varchar', length: 100, unique: true })
  username: string;

  @Column({ name: 'password', type: 'varchar', length: 255 })
  password: string;

  @Column({
    type: 'enum',
    enum: Role,
    default: Role.SUPER_ADMIN,
    name: 'role',
  })
  role: Role;

  @Column({
    name: 'hashed_refresh_token',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  hashed_refresh_token: string | null;

  @OneToOne(() => User, (user: User) => user.auth, { cascade: true })
  user: User;
}
