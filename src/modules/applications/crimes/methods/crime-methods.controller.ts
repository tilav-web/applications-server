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

import { Roles } from '../../../../common/decorators/roles.decorator';
import { Role } from '../../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { normalizePagination } from '../../../../common/utils/pagination.util';
import { CrimeMethodsService } from './crime-methods.service';
import { CreateCrimeMethodDto } from './dto/create-crime-method.dto';
import { UpdateCrimeMethodDto } from './dto/update-crime-method.dto';

@Controller('crime-methods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CrimeMethodsController {
  constructor(private readonly service: CrimeMethodsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  create(@Body() dto: CreateCrimeMethodDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('crime_id') crimeId?: string,
  ) {
    const pagination = normalizePagination(page, limit, 100);
    return this.service.findAll(pagination.page, pagination.limit, search, crimeId);
  }

  @Get('active')
  findAllActive(@Query('crime_id') crimeId?: string) {
    return this.service.findAllActive(crimeId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  update(@Param('id') id: string, @Body() dto: UpdateCrimeMethodDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
