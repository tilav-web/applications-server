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
import { CreateRegionDto } from './dto/create-region.dto';
import { UpdateRegionDto } from './dto/update-region.dto';
import { RegionsService } from './regions.service';

@Controller('regions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Post()
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.INSPECTOR,
    Role.STAFF,
    Role.DISTRICT_OFFICER,
    Role.OPERATOR,
  )
  create(@Body() dto: CreateRegionDto) {
    return this.regionsService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const pagination = normalizePagination(page, limit, 100);
    return this.regionsService.findAll(pagination.page, pagination.limit, search);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.regionsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRegionDto) {
    return this.regionsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.regionsService.remove(id);
  }
}
