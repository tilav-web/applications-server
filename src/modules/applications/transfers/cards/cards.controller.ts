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

import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { Role } from '../../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../../../common/types/jwt-payload.interface';
import { normalizePagination } from '../../../../common/utils/pagination.util';
import { CardsService } from './cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';

const WRITE_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
];

@Controller('cards')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateCardDto) {
    return this.cardsService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('citizen_id') citizenId?: string,
    @Query('bank_id') bankId?: string,
    @Query('owner_state') ownerState?: string,
    @Query('card_number') cardNumber?: string,
    @Query('owner_name') ownerName?: string,
    @Query('phone_number') phoneNumber?: string,
    @Query('expire_date') expireDate?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const pagination = normalizePagination(page, limit, 10);
    return this.cardsService.findAll(
      pagination.page,
      pagination.limit,
      search,
      citizenId,
      {
        bankId,
        ownerState,
        cardNumber,
        ownerName,
        phoneNumber,
        expireDate,
      },
      currentUser,
    );
  }

  @Get('stats')
  getStats(@CurrentUser() currentUser?: JwtAccessPayload) {
    return this.cardsService.getStats(currentUser);
  }

  @Get('export/excel')
  async exportExcel(
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('citizen_id') citizenId?: string,
    @Query('bank_id') bankId?: string,
    @Query('owner_state') ownerState?: string,
    @Query('card_number') cardNumber?: string,
    @Query('owner_name') ownerName?: string,
    @Query('phone_number') phoneNumber?: string,
    @Query('expire_date') expireDate?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.cardsService.exportToExcel(
      search,
      citizenId,
      res,
      {
        bankId,
        ownerState,
        cardNumber,
        ownerName,
        phoneNumber,
        expireDate,
      },
      currentUser,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.cardsService.findOne(id, currentUser);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCardDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.cardsService.update(id, dto, currentUser);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.cardsService.remove(id);
  }
}
