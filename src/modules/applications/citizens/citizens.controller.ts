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
import { CitizensService } from './citizens.service';
import { CreateCitizenDto } from './dto/create-citizen.dto';
import { UpdateCitizenDto } from './dto/update-citizen.dto';

@Controller('citizens')
@UseGuards(JwtAuthGuard)
export class CitizensController {
  constructor(private readonly citizensService: CitizensService) {}

  @Post()
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
  ) {
    return this.citizensService.findAll(Number(page) || 1, Number(limit) || 10, search, {
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
    });
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
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.citizensService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCitizenDto) {
    return this.citizensService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.citizensService.remove(id);
  }
}
