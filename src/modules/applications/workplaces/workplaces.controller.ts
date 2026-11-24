import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { type CreateWorkplaceInput, WorkplacesService } from './workplaces.service';

@Controller('workplaces')
@UseGuards(JwtAuthGuard)
export class WorkplacesController {
  constructor(private readonly service: WorkplacesService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('district_id') district_id?: string,
    @Query('occupation_category_id') occupation_category_id?: string,
    @Query('occupation_id') occupation_id?: string,
    @Query('include_inactive') include_inactive?: string,
  ) {
    return this.service.findAll({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search,
      district_id,
      occupation_category_id,
      occupation_id,
      include_inactive: include_inactive === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() body: CreateWorkplaceInput) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: Partial<CreateWorkplaceInput>) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
