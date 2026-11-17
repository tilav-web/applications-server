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

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CardsService } from './cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';

@Controller('cards')
@UseGuards(JwtAuthGuard)
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Post()
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
  ) {
    return this.cardsService.findAll(Number(page) || 1, Number(limit) || 10, search, citizenId, {
      bankId,
      ownerState,
      cardNumber,
      ownerName,
      phoneNumber,
      expireDate,
    });
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
  ) {
    return this.cardsService.exportToExcel(search, citizenId, res, {
      bankId,
      ownerState,
      cardNumber,
      ownerName,
      phoneNumber,
      expireDate,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cardsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCardDto) {
    return this.cardsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cardsService.remove(id);
  }
}
