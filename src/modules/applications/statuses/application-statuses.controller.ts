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
import { ApplicationStatusesService } from './application-statuses.service';
import { CreateApplicationStatusDto } from './dto/create-application-status.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';

@Controller('application-statuses')
@UseGuards(JwtAuthGuard)
export class ApplicationStatusesController {
  constructor(private readonly statusesService: ApplicationStatusesService) {}

  @Post()
  create(@Body() dto: CreateApplicationStatusDto) {
    return this.statusesService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.statusesService.findAll(Number(page) || 1, Number(limit) || 50, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.statusesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApplicationStatusDto) {
    return this.statusesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.statusesService.remove(id);
  }
}
