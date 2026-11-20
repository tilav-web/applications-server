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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { normalizePagination } from '../../common/utils/pagination.util';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ExportCyberControlDto } from './dto/export-cybercontrol.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { APPLICATION_MASTER_TEMPLATE } from './schemas/default-application-template.schema';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  create(@Body() dto: CreateApplicationDto, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.create(dto, currentUser);
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
    @Query('card_number') card_number?: string,
    @Query('phone_number') phone_number?: string,
    @Query('description') description?: string,
    @Query('date') date?: string,
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
    @Query('relations_filter') relations_filter?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const pagination = normalizePagination(page, limit, 10);
    return this.applicationsService.findAll(
      {
        page: pagination.page,
        limit: pagination.limit,
        search,
        status,
        status_id,
        district_id,
        crime_id,
        crime_method_id,
        application_number,
        citizen_name,
        card_number,
        phone_number,
        description,
        date,
        date_from,
        date_to,
        relations_filter,
      },
      10,
      undefined,
      undefined,
      currentUser,
    );
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
  getRelations(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.getRelations(id, currentUser);
  }

  @Post('export/cybercontrol-template')
  async exportCyberControlTemplate(
    @Body() dto: ExportCyberControlDto,
    @Res() res: Response,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.applicationsService.exportCyberControlTemplate(dto.ids, res, currentUser);
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
    @Query('card_number') card_number?: string,
    @Query('phone_number') phone_number?: string,
    @Query('description') description?: string,
    @Query('date') date?: string,
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
    @Query('relations_filter') relations_filter?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
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
        card_number,
        phone_number,
        description,
        date,
        date_from,
        date_to,
        relations_filter,
      },
      res,
      currentUser,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.findOne(id, currentUser);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.applicationsService.update(id, dto, currentUser);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.remove(id, currentUser);
  }
}
