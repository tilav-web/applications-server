import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { In, Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { PaginatedResult } from '../../common/interfaces/pagination.interface';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { District } from '../applications/districts/district.entity';
import { Auth } from '../auth/auth.entity';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { User } from './user.entity';

export interface UserView {
  id: string;
  username: string;
  role: Role;
  is_root: boolean;
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

  private async assertRootSuperAdmin(currentUser?: JwtAccessPayload): Promise<void> {
    if (!currentUser?.sub) {
      throw new ForbiddenException(
        'Hodimlarni boshqarish faqat Asosiy (Root) Super Admin ga ruxsat etilgan',
      );
    }

    const caller = await this.authRepository.findOne({
      where: { id: currentUser.sub },
      select: { id: true, role: true, is_root: true },
    });

    if (!caller || caller.role !== Role.SUPER_ADMIN || !caller.is_root) {
      throw new ForbiddenException(
        'Hodimlarni boshqarish faqat Asosiy (Root) Super Admin ga ruxsat etilgan',
      );
    }
  }

  private mapAuthToUserView(auth: Auth): UserView {
    return {
      id: auth.id,
      username: auth.username,
      role: auth.role,
      is_root: Boolean(auth.is_root),
      first_name: auth.user?.first_name || null,
      last_name: auth.user?.last_name || null,
      phone_number: auth.user?.phone_number || null,
      assigned_districts:
        auth.user?.assigned_districts?.map((d) => ({ id: d.id, name: d.name })) || [],
      created_at: auth.created_at,
      updated_at: auth.updated_at,
    };
  }

  private async getUserViewById(id: string): Promise<UserView> {
    const auth = await this.authRepository.findOne({
      where: { id },
      relations: { user: { assigned_districts: true } },
    });
    if (!auth) {
      throw new NotFoundException('Hodim topilmadi');
    }
    return this.mapAuthToUserView(auth);
  }

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

  async findAll(
    page = 1,
    limit = 10,
    search?: string,
    filters?: {
      role?: string;
      fullName?: string;
      username?: string;
      phoneNumber?: string;
      districtId?: string;
    },
    currentUser?: JwtAccessPayload,
  ): Promise<PaginatedResult<UserView>> {
    await this.assertRootSuperAdmin(currentUser);

    const take = limit;
    const skip = (page - 1) * limit;

    const query = this.authRepository
      .createQueryBuilder('auth')
      .leftJoinAndSelect('auth.user', 'user')
      .leftJoinAndSelect('user.assigned_districts', 'districts')
      .orderBy('auth.is_root', 'DESC')
      .addOrderBy('auth.created_at', 'DESC')
      .skip(skip)
      .take(take);

    if (filters?.role?.trim()) {
      query.andWhere('auth.role = :role', { role: filters.role.trim() });
    }
    if (filters?.fullName?.trim()) {
      query.andWhere("CONCAT_WS(' ', user.last_name, user.first_name) ILIKE :fullName", {
        fullName: `%${filters.fullName.trim()}%`,
      });
    }
    if (filters?.username?.trim()) {
      const cleanU = filters.username.trim().replace(/^@/, '');
      query.andWhere('auth.username ILIKE :uName', { uName: `%${cleanU}%` });
    }
    if (filters?.phoneNumber?.trim()) {
      const cleanP = filters.phoneNumber.replace(/\D/g, '') || filters.phoneNumber.trim();
      query.andWhere('user.phone_number ILIKE :uPhone', { uPhone: `%${cleanP}%` });
    }
    if (filters?.districtId?.trim()) {
      query.andWhere('districts.id = :uDistrictId', {
        uDistrictId: filters.districtId.trim(),
      });
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query.andWhere(
        '(auth.username ILIKE :q OR user.first_name ILIKE :q OR user.last_name ILIKE :q OR user.phone_number ILIKE :q)',
        { q },
      );
    }

    const [authList, total] = await query.getManyAndCount();

    const items: UserView[] = authList.map((auth) => this.mapAuthToUserView(auth));

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

  async findOne(id: string, currentUser?: JwtAccessPayload): Promise<UserView> {
    await this.assertRootSuperAdmin(currentUser);
    return this.getUserViewById(id);
  }

  async create(dto: CreateUserDto, currentUser?: JwtAccessPayload): Promise<UserView> {
    await this.assertRootSuperAdmin(currentUser);

    const existing = await this.authRepository.findOne({ where: { username: dto.username } });
    if (existing) {
      throw new BadRequestException('Bunday loginli (username) hodim allaqachon mavjud');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const auth = this.authRepository.create({
      username: dto.username,
      password: hashedPassword,
      role: dto.role || Role.STAFF,
      is_root: false,
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

    return this.getUserViewById(savedAuth.id);
  }

  async update(id: string, dto: UpdateUserDto, currentUser?: JwtAccessPayload): Promise<UserView> {
    await this.assertRootSuperAdmin(currentUser);

    const auth = await this.authRepository.findOne({
      where: { id },
      relations: { user: { assigned_districts: true } },
    });
    if (!auth) {
      throw new NotFoundException('Hodim topilmadi');
    }

    if (auth.is_root) {
      if (currentUser?.sub !== auth.id) {
        throw new ForbiddenException(
          'Asosiy (Root) Super Admin hisobini boshqa hodim tahrirlay olmaydi',
        );
      }
      if (dto.role && dto.role !== Role.SUPER_ADMIN) {
        throw new ForbiddenException("Asosiy (Root) Super Admin rolini o'zgartirib bo'lmaydi");
      }
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
      auth.hashed_refresh_token = null;
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

    return this.getUserViewById(auth.id);
  }

  async remove(
    id: string,
    currentUser?: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    await this.assertRootSuperAdmin(currentUser);

    const auth = await this.authRepository.findOne({ where: { id } });
    if (!auth) {
      throw new NotFoundException('Hodim topilmadi');
    }
    if (auth.is_root) {
      throw new ForbiddenException("Asosiy (Root) Super Admin hisobini o'chirib bo'lmaydi");
    }
    if (currentUser?.sub === auth.id) {
      throw new ForbiddenException("O'zingizning hisobingizni o'chira olmaysiz");
    }
    await this.authRepository.remove(auth);
    return { success: true, message: "Hodim o'chirildi" };
  }
}
