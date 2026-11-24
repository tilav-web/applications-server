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

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { CreateNeighborhoodDto } from './dto/create-neighborhood.dto';
import { UpdateNeighborhoodDto } from './dto/update-neighborhood.dto';
import { NeighborhoodsService } from './neighborhoods.service';

@Controller('neighborhoods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NeighborhoodsController {
  constructor(private readonly neighborhoodsService: NeighborhoodsService) {}

  @Post()
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.INSPECTOR,
    Role.STAFF,
    Role.DISTRICT_OFFICER,
    Role.OPERATOR,
  )
  create(@Body() dto: CreateNeighborhoodDto) {
    return this.neighborhoodsService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('district_id') districtId?: string,
    @Query('search') search?: string,
  ) {
    const pagination = normalizePagination(page, limit, 100);
    return this.neighborhoodsService.findAll(pagination.page, pagination.limit, districtId, search);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.neighborhoodsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNeighborhoodDto) {
    return this.neighborhoodsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.neighborhoodsService.remove(id);
  }
}
