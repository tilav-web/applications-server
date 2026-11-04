import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findByAuthId(authId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { auth_id: authId } });
  }

  async createProfile(authId: string, profileData: Partial<User>): Promise<User> {
    const user = this.userRepository.create({
      ...profileData,
      auth_id: authId,
    });
    return this.userRepository.save(user);
  }
}
