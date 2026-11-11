import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ApplicationSourcesService } from './sources.service';

@UseGuards(JwtAuthGuard)
@Controller('application-sources')
export class ApplicationSourcesController {
  constructor(private readonly sourcesService: ApplicationSourcesService) {}

  @Get()
  async getAll(@Query('includeInactive') includeInactive?: string) {
    return this.sourcesService.findAll(includeInactive === 'true');
  }

  @Post()
  async create(@Body() body: { name: string; code?: string; is_active?: boolean }) {
    return this.sourcesService.create(body);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; code?: string; is_active?: boolean },
  ) {
    return this.sourcesService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.sourcesService.remove(id);
  }

  @Post('seed')
  async seed() {
    await this.sourcesService.seedDefaults();
    return { success: true, message: 'Boshlang‘ich murojaat manbalari saqlandi' };
  }
}
