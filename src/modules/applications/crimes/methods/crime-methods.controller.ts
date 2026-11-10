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

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CrimeMethodsService } from './crime-methods.service';
import { CreateCrimeMethodDto } from './dto/create-crime-method.dto';
import { UpdateCrimeMethodDto } from './dto/update-crime-method.dto';

@Controller('crime-methods')
@UseGuards(JwtAuthGuard)
export class CrimeMethodsController {
  constructor(private readonly service: CrimeMethodsService) {}

  @Post()
  create(@Body() dto: CreateCrimeMethodDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(Number(page) || 1, Number(limit) || 100, search);
  }

  @Get('active')
  findAllActive() {
    return this.service.findAllActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCrimeMethodDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

