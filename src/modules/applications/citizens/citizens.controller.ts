import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { CitizensService } from './citizens.service';
import { CreateCitizenDto } from './dto/create-citizen.dto';
import { UpdateCitizenDto } from './dto/update-citizen.dto';

const WRITE_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
];

@Controller('citizens')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CitizensController {
  constructor(private readonly citizensService: CitizensService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateCitizenDto) {
    return this.citizensService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('full_name') fullName?: string,
    @Query('first_name') firstName?: string,
    @Query('last_name') lastName?: string,
    @Query('middle_name') middleName?: string,
    @Query('passport') passport?: string,
    @Query('phone_number') phoneNumber?: string,
    @Query('card_number') cardNumber?: string,
    @Query('pinfl') pinfl?: string,
    @Query('gender') gender?: string,
    @Query('birth_date') birthDate?: string,
    @Query('district_id') districtId?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const pagination = normalizePagination(page, limit, 10);
    return this.citizensService.findAll(
      pagination.page,
      pagination.limit,
      search,
      {
        fullName,
        firstName,
        lastName,
        middleName,
        passport,
        phoneNumber,
        cardNumber,
        pinfl,
        gender,
        birthDate,
        districtId,
      },
      currentUser,
    );
  }

  @Get('stats')
  getStats(@CurrentUser() currentUser?: JwtAccessPayload) {
    return this.citizensService.getStats(currentUser);
  }

  @Get('export/excel')
  async exportExcel(
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('full_name') fullName?: string,
    @Query('first_name') firstName?: string,
    @Query('last_name') lastName?: string,
    @Query('middle_name') middleName?: string,
    @Query('passport') passport?: string,
    @Query('phone_number') phoneNumber?: string,
    @Query('card_number') cardNumber?: string,
    @Query('pinfl') pinfl?: string,
    @Query('gender') gender?: string,
    @Query('birth_date') birthDate?: string,
    @Query('district_id') districtId?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.citizensService.exportToExcel(
      search,
      {
        fullName,
        firstName,
        lastName,
        middleName,
        passport,
        phoneNumber,
        cardNumber,
        pinfl,
        gender,
        birthDate,
        districtId,
      },
      res,
      currentUser,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.citizensService.findOne(id, currentUser);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCitizenDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.citizensService.update(id, dto, currentUser);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.citizensService.remove(id);
  }
}
