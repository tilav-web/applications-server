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
import { CreateMahallaDto } from './dto/create-mahalla.dto';
import { UpdateMahallaDto } from './dto/update-mahalla.dto';
import { MahallasService } from './mahallas.service';

@Controller('mahallas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MahallasController {
  constructor(private readonly mahallasService: MahallasService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  create(@Body() dto: CreateMahallaDto) {
    return this.mahallasService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('district_id') districtId?: string,
    @Query('search') search?: string,
  ) {
    const pagination = normalizePagination(page, limit, 100);
    return this.mahallasService.findAll(pagination.page, pagination.limit, districtId, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mahallasService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  update(@Param('id') id: string, @Body() dto: UpdateMahallaDto) {
    return this.mahallasService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.mahallasService.remove(id);
  }
}
