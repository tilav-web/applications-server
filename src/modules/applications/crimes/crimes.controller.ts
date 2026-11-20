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
import { CrimesService } from './crimes.service';
import { CreateCrimeDto } from './dto/create-crime.dto';
import { UpdateCrimeDto } from './dto/update-crime.dto';

@Controller('crimes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CrimesController {
  constructor(private readonly crimesService: CrimesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  create(@Body() dto: CreateCrimeDto) {
    return this.crimesService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const pagination = normalizePagination(page, limit, 50);
    return this.crimesService.findAll(pagination.page, pagination.limit, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.crimesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  update(@Param('id') id: string, @Body() dto: UpdateCrimeDto) {
    return this.crimesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.crimesService.remove(id);
  }
}
