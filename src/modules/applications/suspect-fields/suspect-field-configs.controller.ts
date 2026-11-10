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
import { CreateSuspectFieldConfigDto } from './dto/create-suspect-field-config.dto';
import { UpdateSuspectFieldConfigDto } from './dto/update-suspect-field-config.dto';
import { SuspectFieldConfigsService } from './suspect-field-configs.service';

@Controller('suspect-field-configs')
@UseGuards(JwtAuthGuard)
export class SuspectFieldConfigsController {
  constructor(private readonly service: SuspectFieldConfigsService) {}

  @Post()
  create(@Body() dto: CreateSuspectFieldConfigDto) {
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
  update(@Param('id') id: string, @Body() dto: UpdateSuspectFieldConfigDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
