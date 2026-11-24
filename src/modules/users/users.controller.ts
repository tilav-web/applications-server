import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { normalizePagination } from '../../common/utils/pagination.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: JwtAccessPayload,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('full_name') fullName?: string,
    @Query('username') username?: string,
    @Query('phone_number') phoneNumber?: string,
    @Query('district_id') districtId?: string,
  ) {
    const pagination = normalizePagination(page, limit, 10);
    return this.usersService.findAll(
      pagination.page,
      pagination.limit,
      search,
      {
        role,
        fullName,
        username,
        phoneNumber,
        districtId,
      },
      currentUser,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() currentUser: JwtAccessPayload) {
    return this.usersService.findOne(id, currentUser);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() currentUser: JwtAccessPayload) {
    return this.usersService.create(dto, currentUser);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: JwtAccessPayload,
  ) {
    return this.usersService.update(id, dto, currentUser);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() currentUser: JwtAccessPayload) {
    return this.usersService.remove(id, currentUser);
  }
}
