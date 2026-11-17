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

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransfersService } from './transfers.service';

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
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
  ) {
    return this.transfersService.findAll(Number(page) || 1, Number(limit) || 10, search, {
      applicationId,
      status,
      providerId,
      transactionId,
      senderCardNumber,
      receiverCardNumber,
      transferDate,
    });
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
  ) {
    return this.transfersService.exportToExcel(search, res, {
      applicationId,
      status,
      providerId,
      transactionId,
      senderCardNumber,
      receiverCardNumber,
      transferDate,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transfersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTransferDto) {
    return this.transfersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.transfersService.remove(id);
  }
}
