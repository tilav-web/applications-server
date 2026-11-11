import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { In, Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { PaginatedResult } from '../../common/interfaces/pagination.interface';
import { District } from '../applications/districts/district.entity';
import { Auth } from '../auth/auth.entity';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { User } from './user.entity';

export interface UserView {
  id: string;
  username: string;
  role: Role;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  assigned_districts?: { id: string; name: string | null }[];
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Auth)
    private readonly authRepository: Repository<Auth>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
  ) {}

  async findByAuthId(authId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { auth_id: authId },
      relations: { assigned_districts: true },
    });
  }

  async createProfile(authId: string, profileData: Partial<User>): Promise<User> {
    const user = this.userRepository.create({
      ...profileData,
      auth_id: authId,
    });
    return this.userRepository.save(user);
  }

  async findAll(page = 1, limit = 10, search?: string): Promise<PaginatedResult<UserView>> {
    const take = limit;
    const skip = (page - 1) * limit;

    const query = this.authRepository
      .createQueryBuilder('auth')
      .leftJoinAndSelect('auth.user', 'user')
      .leftJoinAndSelect('user.assigned_districts', 'districts')
      .orderBy('auth.created_at', 'DESC')
      .skip(skip)
      .take(take);

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query.andWhere(
        '(auth.username ILIKE :q OR user.first_name ILIKE :q OR user.last_name ILIKE :q OR user.phone_number ILIKE :q)',
        { q },
      );
    }

    const [authList, total] = await query.getManyAndCount();

    const items: UserView[] = authList.map((auth) => ({
      id: auth.id,
      username: auth.username,
      role: auth.role,
      first_name: auth.user?.first_name || null,
      last_name: auth.user?.last_name || null,
      phone_number: auth.user?.phone_number || null,
      assigned_districts:
        auth.user?.assigned_districts?.map((d) => ({ id: d.id, name: d.name })) || [],
      created_at: auth.created_at,
      updated_at: auth.updated_at,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(id: string): Promise<UserView> {
    const auth = await this.authRepository.findOne({
      where: { id },
      relations: { user: { assigned_districts: true } },
    });
    if (!auth) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }
    return {
      id: auth.id,
      username: auth.username,
      role: auth.role,
      first_name: auth.user?.first_name || null,
      last_name: auth.user?.last_name || null,
      phone_number: auth.user?.phone_number || null,
      assigned_districts:
        auth.user?.assigned_districts?.map((d) => ({ id: d.id, name: d.name })) || [],
      created_at: auth.created_at,
      updated_at: auth.updated_at,
    };
  }

  async create(dto: CreateUserDto): Promise<UserView> {
    const existing = await this.authRepository.findOne({ where: { username: dto.username } });
    if (existing) {
      throw new BadRequestException('Bunday loginli (username) foydalanuvchi allaqachon mavjud');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const auth = this.authRepository.create({
      username: dto.username,
      password: hashedPassword,
      role: dto.role || Role.STAFF,
    });
    const savedAuth = await this.authRepository.save(auth);

    let assignedDistricts: District[] = [];
    if (dto.assigned_district_ids && dto.assigned_district_ids.length > 0) {
      assignedDistricts = await this.districtRepository.findBy({
        id: In(dto.assigned_district_ids),
      });
    }

    const user = this.userRepository.create({
      auth_id: savedAuth.id,
      first_name: dto.first_name || null,
      last_name: dto.last_name || null,
      phone_number: dto.phone_number || null,
      assigned_districts: assignedDistricts,
    });
    await this.userRepository.save(user);

    return this.findOne(savedAuth.id);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserView> {
    const auth = await this.authRepository.findOne({
      where: { id },
      relations: { user: { assigned_districts: true } },
    });
    if (!auth) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    if (dto.username && dto.username !== auth.username) {
      const existing = await this.authRepository.findOne({ where: { username: dto.username } });
      if (existing) {
        throw new BadRequestException('Ushbu login band');
      }
      auth.username = dto.username;
    }

    if (dto.password) {
      auth.password = await bcrypt.hash(dto.password, 10);
    }

    if (dto.role) {
      auth.role = dto.role;
    }

    await this.authRepository.save(auth);

    let user = auth.user;
    if (!user) {
      user = this.userRepository.create({
        auth_id: auth.id,
      });
    }

    if (dto.first_name !== undefined) user.first_name = dto.first_name;
    if (dto.last_name !== undefined) user.last_name = dto.last_name;
    if (dto.phone_number !== undefined) user.phone_number = dto.phone_number;

    if (dto.assigned_district_ids !== undefined) {
      if (dto.assigned_district_ids.length > 0) {
        user.assigned_districts = await this.districtRepository.findBy({
          id: In(dto.assigned_district_ids),
        });
      } else {
        user.assigned_districts = [];
      }
    }

    await this.userRepository.save(user);

    return this.findOne(auth.id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const auth = await this.authRepository.findOne({ where: { id } });
    if (!auth) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }
    await this.authRepository.remove(auth);
    return { success: true, message: "Foydalanuvchi o'chirildi" };
  }
}
