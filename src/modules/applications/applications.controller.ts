import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { APPLICATION_MASTER_TEMPLATE } from './schemas/default-application-template.schema';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  create(@Body() dto: CreateApplicationDto) {
    return this.applicationsService.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('status_id') status_id?: string,
    @Query('district_id') district_id?: string,
    @Query('crime_id') crime_id?: string,
    @Query('crime_method_id') crime_method_id?: string,
    @Query('application_number') application_number?: string,
    @Query('citizen_name') citizen_name?: string,
    @Query('description') description?: string,
    @Query('date') date?: string,
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
    @Query('relations_filter') relations_filter?: string,
  ) {
    return this.applicationsService.findAll({
      page: Number(page) || 1,
      limit: Number(limit) || 10,
      search,
      status,
      status_id,
      district_id,
      crime_id,
      crime_method_id,
      application_number,
      citizen_name,
      description,
      date,
      date_from,
      date_to,
      relations_filter,
    });
  }

  /**
   * Frontend Form Builder / Dynamic Template uchun sxemani olish:
   * Master shablon va uning barcha sub-shablonlari (Fuqarolar, Jinoyatlar, Kartalar, O'tkazmalar)
   */
  @Get('template/schema')
  getTemplateSchema() {
    return APPLICATION_MASTER_TEMPLATE;
  }

  @Get('statistics')
  getStatistics(
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.applicationsService.getStatistics(period, startDate, endDate);
  }

  @Get(':id/relations')
  getRelations(@Param('id') id: string) {
    return this.applicationsService.getRelations(id);
  }

  @Get('export/excel')
  async exportExcel(
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('status_id') status_id?: string,
    @Query('district_id') district_id?: string,
    @Query('crime_id') crime_id?: string,
    @Query('crime_method_id') crime_method_id?: string,
    @Query('application_number') application_number?: string,
    @Query('citizen_name') citizen_name?: string,
    @Query('description') description?: string,
    @Query('date') date?: string,
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
    @Query('relations_filter') relations_filter?: string,
  ) {
    return this.applicationsService.exportToExcel(
      {
        search,
        status,
        status_id,
        district_id,
        crime_id,
        crime_method_id,
        application_number,
        citizen_name,
        description,
        date,
        date_from,
        date_to,
        relations_filter,
      },
      res,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.applicationsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.applicationsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.applicationsService.remove(id);
  }
}
