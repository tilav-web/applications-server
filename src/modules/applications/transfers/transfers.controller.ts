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
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransfersService } from './transfers.service';

const WRITE_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
];

@Controller('transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateTransferDto) {
    return this.transfersService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('application_id') applicationId?: string,
    @Query('status') status?: string,
    @Query('payment_provider_id') providerId?: string,
    @Query('transaction_id') transactionId?: string,
    @Query('sender_card_number') senderCardNumber?: string,
    @Query('receiver_card_number') receiverCardNumber?: string,
    @Query('transfer_date') transferDate?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const pagination = normalizePagination(page, limit, 10);
    return this.transfersService.findAll(
      pagination.page,
      pagination.limit,
      search,
      {
        applicationId,
        status,
        providerId,
        transactionId,
        senderCardNumber,
        receiverCardNumber,
        transferDate,
      },
      currentUser,
    );
  }

  @Get('stats')
  getStats(@CurrentUser() currentUser?: JwtAccessPayload) {
    return this.transfersService.getStats(currentUser);
  }

  @Get('export/excel')
  async exportExcel(
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('application_id') applicationId?: string,
    @Query('status') status?: string,
    @Query('payment_provider_id') providerId?: string,
    @Query('transaction_id') transactionId?: string,
    @Query('sender_card_number') senderCardNumber?: string,
    @Query('receiver_card_number') receiverCardNumber?: string,
    @Query('transfer_date') transferDate?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.transfersService.exportToExcel(
      search,
      res,
      {
        applicationId,
        status,
        providerId,
        transactionId,
        senderCardNumber,
        receiverCardNumber,
        transferDate,
      },
      currentUser,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.transfersService.findOne(id, currentUser);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTransferDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.transfersService.update(id, dto, currentUser);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.transfersService.remove(id);
  }
}
