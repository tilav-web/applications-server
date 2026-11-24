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
import { CreateSuspectFieldConfigDto } from './dto/create-suspect-field-config.dto';
import { UpdateSuspectFieldConfigDto } from './dto/update-suspect-field-config.dto';
import { SuspectFieldConfigsService } from './suspect-field-configs.service';

@Controller('suspect-field-configs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuspectFieldConfigsController {
  constructor(private readonly service: SuspectFieldConfigsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  create(@Body() dto: CreateSuspectFieldConfigDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const pagination = normalizePagination(page, limit, 100);
    return this.service.findAll(pagination.page, pagination.limit, search);
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
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  update(@Param('id') id: string, @Body() dto: UpdateSuspectFieldConfigDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
