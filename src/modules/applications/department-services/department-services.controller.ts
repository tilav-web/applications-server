import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { DepartmentServicesService } from './department-services.service';

@UseGuards(JwtAuthGuard)
@Controller('department-services')
export class DepartmentServicesController {
  constructor(private readonly servicesService: DepartmentServicesService) {}

  @Get()
  async getAll(@Query('includeInactive') includeInactive?: string) {
    return this.servicesService.findAll(includeInactive === 'true');
  }

  @Post()
  async create(@Body() body: { name: string; short_name?: string; is_active?: boolean }) {
    return this.servicesService.create(body);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; short_name?: string; is_active?: boolean },
  ) {
    return this.servicesService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }

  @Post('seed')
  async seed() {
    await this.servicesService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich sohaviy xizmatlar saqlandi' };
  }
}
