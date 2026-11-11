import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OccupationsService } from './occupations.service';

@UseGuards(JwtAuthGuard)
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
  async deleteOccupation(@Param('id') id: string) {
    return this.occupationsService.removeOccupation(id);
  }

  @Post('occupations/seed')
  async seed() {
    await this.occupationsService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich kasb toifalari muvaffaqiyatli saqlandi' };
  }
}
