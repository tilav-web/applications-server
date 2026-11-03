import { Column, Entity, OneToOne } from 'typeorm';

import { BaseEntity } from '../../common/database/base.entity';
import { User } from '../users/user.entity';

@Entity('auth')
export class Auth extends BaseEntity {
  @Column({ name: 'username', type: 'varchar', length: 100, unique: true })
  username: string;

  @Column({ name: 'password', type: 'varchar', length: 255 })
  password: string;

  @OneToOne(() => User, (user: User) => user.auth, { cascade: true })
  user: User;
}
