import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { DepartmentServicesService } from './department-services.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('department-services')
export class DepartmentServicesController {
  constructor(private readonly servicesService: DepartmentServicesService) {}

  @Get()
  async getAll(@Query('includeInactive') includeInactive?: string) {
    return this.servicesService.findAll(includeInactive === 'true');
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async create(@Body() body: { name: string; short_name?: string; is_active?: boolean }) {
    return this.servicesService.create(body);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; short_name?: string; is_active?: boolean },
  ) {
    return this.servicesService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }

  @Post('seed')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async seed() {
    await this.servicesService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich sohaviy xizmatlar saqlandi' };
  }
}
