import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { normalizePagination } from '../../common/utils/pagination.util';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ExportCyberControlDto } from './dto/export-cybercontrol.dto';
import { ExtendDeadlineDto } from './dto/extend-deadline.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { APPLICATION_MASTER_TEMPLATE } from './schemas/default-application-template.schema';

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.STAFF,
    Role.INSPECTOR,
    Role.OPERATOR,
    Role.DISTRICT_OFFICER,
  )
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
    @Query('min_amount') min_amount?: string,
    @Query('max_amount') max_amount?: string,
    @Query('relations_filter') relations_filter?: string,
    @Query('sla_filter') sla_filter?: string,
    @Query('repeat_type') repeat_type?: string,
    @Query('appeal_type') appeal_type?: string,
    @Query('submission_form') submission_form?: string,
    @Query('awareness_status_id') awareness_status_id?: string,
    @Query('external_system_id') external_system_id?: string,
    @Query('external_system_status') external_system_status?: string,
    @Query('missing_external_system_id') missing_external_system_id?: string,
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
        min_amount,
        max_amount,
        relations_filter,
        sla_filter,
        repeat_type,
        appeal_type,
        submission_form,
        awareness_status_id,
        external_system_id,
        external_system_status,
        missing_external_system_id,
      },
      10,
      undefined,
      undefined,
      currentUser,
    );
  }

  @Get('sla/overview')
  getSlaOverview(@CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.getSlaOverview(currentUser);
  }

  @Post(':id/extend-deadline')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.STAFF,
    Role.INSPECTOR,
    Role.OPERATOR,
    Role.DISTRICT_OFFICER,
  )
  extendDeadline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExtendDeadlineDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.applicationsService.extendDeadline(id, body, currentUser);
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
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.applicationsService.getStatistics(period, startDate, endDate, currentUser);
  }

  @Get('by-citizen/:citizenId')
  findByCitizen(
    @Param('citizenId', ParseUUIDPipe) citizenId: string,
    @Query('exclude_id') excludeId?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.applicationsService.findByCitizen(citizenId, excludeId, currentUser);
  }

  @Get(':id/chain')
  getChain(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.getApplicationChain(id, currentUser);
  }

  @Get(':id/relations')
  getRelations(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
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
    @Query('min_amount') min_amount?: string,
    @Query('max_amount') max_amount?: string,
    @Query('relations_filter') relations_filter?: string,
    @Query('repeat_type') repeat_type?: string,
    @Query('appeal_type') appeal_type?: string,
    @Query('submission_form') submission_form?: string,
    @Query('awareness_status_id') awareness_status_id?: string,
    @Query('external_system_id') external_system_id?: string,
    @Query('external_system_status') external_system_status?: string,
    @Query('missing_external_system_id') missing_external_system_id?: string,
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
        min_amount,
        max_amount,
        relations_filter,
        repeat_type,
        appeal_type,
        submission_form,
        awareness_status_id,
        external_system_id,
        external_system_status,
        missing_external_system_id,
      },
      res,
      currentUser,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.findOne(id, currentUser);
  }

  @Patch(':id/external-systems')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.STAFF,
    Role.INSPECTOR,
    Role.OPERATOR,
    Role.DISTRICT_OFFICER,
  )
  toggleExternalSystem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { external_system_id: string; entered: boolean },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.applicationsService.toggleExternalSystem(
      id,
      body.external_system_id,
      Boolean(body.entered),
      currentUser,
    );
  }

  @Patch(':id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.STAFF,
    Role.INSPECTOR,
    Role.OPERATOR,
    Role.DISTRICT_OFFICER,
  )
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.applicationsService.update(id, dto, currentUser);
  }

  @Delete(':id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.STAFF,
    Role.INSPECTOR,
    Role.OPERATOR,
    Role.DISTRICT_OFFICER,
  )
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.applicationsService.remove(id, currentUser);
  }
}
