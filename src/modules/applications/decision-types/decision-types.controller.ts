import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { DecisionTypesService } from './decision-types.service';

@UseGuards(JwtAuthGuard)
@Controller('decision-types')
export class DecisionTypesController {
  constructor(private readonly decisionTypesService: DecisionTypesService) {}

  @Get()
  async getAll(@Query('includeInactive') includeInactive?: string) {
    return this.decisionTypesService.findAll(includeInactive === 'true');
  }

  @Post()
  async create(@Body() body: { name: string; is_active?: boolean }) {
    return this.decisionTypesService.create(body);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return this.decisionTypesService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.decisionTypesService.remove(id);
  }

  @Post('seed')
  async seed() {
    await this.decisionTypesService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich qaror turlari saqlandi' };
  }
}
