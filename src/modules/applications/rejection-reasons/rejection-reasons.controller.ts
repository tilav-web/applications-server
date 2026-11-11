import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RejectionReasonsService } from './rejection-reasons.service';

@UseGuards(JwtAuthGuard)
@Controller('rejection-reasons')
export class RejectionReasonsController {
  constructor(private readonly reasonsService: RejectionReasonsService) {}

  @Get()
  async getAll(@Query('includeInactive') includeInactive?: string) {
    return this.reasonsService.findAll(includeInactive === 'true');
  }

  @Post()
  async create(@Body() body: { name: string; is_active?: boolean }) {
    return this.reasonsService.create(body);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return this.reasonsService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.reasonsService.remove(id);
  }

  @Post('seed')
  async seed() {
    await this.reasonsService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich rad etish sabablari saqlandi' };
  }
}
