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
import { CreateMahallaDto } from './dto/create-mahalla.dto';
import { UpdateMahallaDto } from './dto/update-mahalla.dto';
import { MahallasService } from './mahallas.service';

@Controller('mahallas')
@UseGuards(JwtAuthGuard)
export class MahallasController {
  constructor(private readonly mahallasService: MahallasService) {}

  @Post()
  create(@Body() dto: CreateMahallaDto) {
    return this.mahallasService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('district_id') districtId?: string,
    @Query('search') search?: string,
  ) {
    return this.mahallasService.findAll(
      Number(page) || 1,
      Number(limit) || 100,
      districtId,
      search,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mahallasService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMahallaDto) {
    return this.mahallasService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mahallasService.remove(id);
  }
}
