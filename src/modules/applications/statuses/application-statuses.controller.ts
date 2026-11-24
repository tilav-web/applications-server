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

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { ApplicationStatusesService } from './application-statuses.service';
import { CreateApplicationStatusDto } from './dto/create-application-status.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';

@Controller('application-statuses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationStatusesController {
  constructor(private readonly statusesService: ApplicationStatusesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  create(@Body() dto: CreateApplicationStatusDto) {
    return this.statusesService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const pagination = normalizePagination(page, limit, 50);
    return this.statusesService.findAll(pagination.page, pagination.limit, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.statusesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  update(@Param('id') id: string, @Body() dto: UpdateApplicationStatusDto) {
    return this.statusesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id') id: string) {
    return this.statusesService.remove(id);
  }
}
