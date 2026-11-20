import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { DecisionTypesService } from './decision-types.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('decision-types')
export class DecisionTypesController {
  constructor(private readonly decisionTypesService: DecisionTypesService) {}

  @Get()
  async getAll(@Query('includeInactive') includeInactive?: string) {
    return this.decisionTypesService.findAll(includeInactive === 'true');
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  async create(@Body() body: { name: string; is_active?: boolean }) {
    return this.decisionTypesService.create(body);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR)
  async update(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return this.decisionTypesService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async remove(@Param('id') id: string) {
    return this.decisionTypesService.remove(id);
  }

  @Post('seed')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async seed() {
    await this.decisionTypesService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich qaror turlari saqlandi' };
  }
}
