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
    @Query('first_name') firstName?: string,
    @Query('last_name') lastName?: string,
    @Query('middle_name') middleName?: string,
    @Query('passport') passport?: string,
    @Query('phone_number') phoneNumber?: string,
    @Query('pinfl') pinfl?: string,
    @Query('gender') gender?: string,
    @Query('birth_date') birthDate?: string,
  ) {
    return this.citizensService.findAll(Number(page) || 1, Number(limit) || 10, search, {
      firstName,
      lastName,
      middleName,
      passport,
      phoneNumber,
      pinfl,
      gender,
      birthDate,
    });
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
