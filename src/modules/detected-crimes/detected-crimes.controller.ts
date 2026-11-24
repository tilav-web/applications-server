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
import { DetectedCrimeStatusesService } from './detected-crime-statuses.service';
import { DetectedCrimesService } from './detected-crimes.service';
import { DetectionSourcesService } from './detection-sources.service';
import {
  CreateDetectedCrimeStatusDto,
  CreateDetectionSourceDto,
  ExtendDetectedCrimeDeadlineDto,
  SaveDetectedCrimeDto,
  UpdateDetectedCrimeDto,
  UpdateDetectedCrimeStatusDto,
  UpdateDetectionSourceDto,
} from './dto/detected-crimes.dto';

const REF_WRITE_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF, Role.INSPECTOR];

@Controller('detected-crime-statuses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DetectedCrimeStatusesController {
  constructor(private readonly service: DetectedCrimeStatusesService) {}

  @Get()
  findAll(@Query('include_inactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Post()
  @Roles(...REF_WRITE_ROLES)
  create(@Body() body: CreateDetectedCrimeStatusDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles(...REF_WRITE_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDetectedCrimeStatusDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}

@Controller('detection-sources')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DetectionSourcesController {
  constructor(private readonly service: DetectionSourcesService) {}

  @Get()
  findAll(@Query('include_inactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Post()
  @Roles(...REF_WRITE_ROLES)
  create(@Body() body: CreateDetectionSourceDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles(...REF_WRITE_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDetectionSourceDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}

@Controller('detected-crimes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DetectedCrimesController {
  constructor(private readonly service: DetectedCrimesService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('district_id') district_id?: string,
    @Query('crime_id') crime_id?: string,
    @Query('detection_source_id') detection_source_id?: string,
    @Query('crime_status_id') crime_status_id?: string,
    @Query('status_id') status_id?: string,
    @Query('qualification_type') qualification_type?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const pagination = normalizePagination(page, limit, 15, 200);
    return this.service.findAll(
      {
        page: pagination.page,
        limit: pagination.limit,
        search,
        district_id,
        crime_id,
        detection_source_id,
        crime_status_id: crime_status_id || status_id,
        qualification_type,
      },
      currentUser,
    );
  }

  @Get('stats')
  getStats(@CurrentUser() currentUser?: JwtAccessPayload) {
    return this.service.getStats(currentUser);
  }

  @Get('map-stats')
  getMapStats(
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.getMapStats({ period, startDate, endDate }, currentUser);
  }

  @Get('citizen/:citizenId')
  getByCitizen(
    @Param('citizenId', ParseUUIDPipe) citizenId: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.findByCitizenId(citizenId, currentUser);
  }

  @Get('citizen/:citizenId/repeat-check')
  checkRepeat(
    @Param('citizenId', ParseUUIDPipe) citizenId: string,
    @Query('exclude_id') excludeId?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.checkCitizenRepeatHistory(citizenId, excludeId, currentUser);
  }

  @Get('export/excel')
  exportExcel(
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('district_id') district_id?: string,
    @Query('crime_id') crime_id?: string,
    @Query('detection_source_id') detection_source_id?: string,
    @Query('crime_status_id') crime_status_id?: string,
    @Query('status_id') status_id?: string,
    @Query('qualification_type') qualification_type?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.exportExcel(
      {
        search,
        district_id,
        crime_id,
        detection_source_id,
        crime_status_id: crime_status_id || status_id,
        qualification_type,
      },
      res,
      currentUser,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.service.findOne(id, currentUser);
  }

  @Post()
  create(@Body() body: SaveDetectedCrimeDto, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.service.create(body, currentUser);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDetectedCrimeDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.update(id, body, currentUser);
  }

  @Post(':id/extend-deadline')
  extendDeadline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExtendDetectedCrimeDeadlineDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.extendDeadline(id, body, currentUser);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.service.remove(id, currentUser);
  }
}
