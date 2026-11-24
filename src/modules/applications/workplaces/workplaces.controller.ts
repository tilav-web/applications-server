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
import { CreateWorkplaceDto, UpdateWorkplaceDto } from './dto/workplace.dto';
import { WorkplacesService } from './workplaces.service';

@Controller('workplaces')
@UseGuards(JwtAuthGuard, RolesGuard)
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
    const pagination = normalizePagination(page, limit, 20, 200);
    return this.service.findAll({
      page: pagination.page,
      limit: pagination.limit,
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
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF, Role.INSPECTOR)
  create(@Body() body: CreateWorkplaceDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF, Role.INSPECTOR)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateWorkplaceDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
