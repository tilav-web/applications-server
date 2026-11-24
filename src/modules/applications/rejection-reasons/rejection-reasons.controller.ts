import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RejectionReasonsService } from './rejection-reasons.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rejection-reasons')
export class RejectionReasonsController {
  constructor(private readonly reasonsService: RejectionReasonsService) {}

  @Get()
  async getAll(@Query('includeInactive') includeInactive?: string) {
    return this.reasonsService.findAll(includeInactive === 'true');
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async create(@Body() body: { name: string; is_active?: boolean }) {
    return this.reasonsService.create(body);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async update(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return this.reasonsService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async remove(@Param('id') id: string) {
    return this.reasonsService.remove(id);
  }

  @Post('seed')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async seed() {
    await this.reasonsService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich rad etish sabablari saqlandi' };
  }
}
