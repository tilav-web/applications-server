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
import { CrimesService } from './crimes.service';
import { CreateCrimeDto } from './dto/create-crime.dto';
import { UpdateCrimeDto } from './dto/update-crime.dto';

@Controller('crimes')
@UseGuards(JwtAuthGuard)
export class CrimesController {
  constructor(private readonly crimesService: CrimesService) {}

  @Post()
  create(@Body() dto: CreateCrimeDto) {
    return this.crimesService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.crimesService.findAll(Number(page) || 1, Number(limit) || 50, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.crimesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCrimeDto) {
    return this.crimesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.crimesService.remove(id);
  }
}
