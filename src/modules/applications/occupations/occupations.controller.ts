import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { OccupationsService } from './occupations.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class OccupationsController {
  constructor(private readonly occupationsService: OccupationsService) {}

  // ==========================================================================
  // CATEGORIES
  // ==========================================================================
  @Get('occupation-categories')
  async getCategories(@Query('includeInactive') includeInactive?: string) {
    return this.occupationsService.findAllCategories(includeInactive === 'true');
  }

  @Post('occupation-categories')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async createCategory(
    @Body()
    body: {
      name: string;
      code?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.occupationsService.createCategory(body);
  }

  @Put('occupation-categories/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async updateCategory(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.occupationsService.updateCategory(id, body);
  }

  @Delete('occupation-categories/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async deleteCategory(@Param('id') id: string) {
    return this.occupationsService.removeCategory(id);
  }

  // ==========================================================================
  // OCCUPATIONS (Turlar)
  // ==========================================================================
  @Get('occupations')
  async getOccupations(
    @Query('category_id') categoryId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.occupationsService.findAllOccupations(categoryId, includeInactive === 'true');
  }

  @Post('occupations')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async createOccupation(
    @Body()
    body: {
      category_id: string;
      name: string;
      code?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.occupationsService.createOccupation(body);
  }

  @Put('occupations/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.INSPECTOR, Role.STAFF)
  async updateOccupation(
    @Param('id') id: string,
    @Body()
    body: {
      category_id?: string;
      name?: string;
      code?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.occupationsService.updateOccupation(id, body);
  }

  @Delete('occupations/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async deleteOccupation(@Param('id') id: string) {
    return this.occupationsService.removeOccupation(id);
  }

  @Post('occupations/seed')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async seed() {
    await this.occupationsService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich kasb toifalari muvaffaqiyatli saqlandi' };
  }
}
