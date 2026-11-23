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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { DetectedCrimeStatusesService } from './detected-crime-statuses.service';
import { DetectedCrimesService, type SaveDetectedCrimeInput } from './detected-crimes.service';
import { DetectionSourcesService } from './detection-sources.service';

@Controller('detected-crime-statuses')
@UseGuards(JwtAuthGuard)
export class DetectedCrimeStatusesController {
  constructor(private readonly service: DetectedCrimeStatusesService) {}

  @Get()
  findAll(@Query('include_inactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      code?: string;
      color?: string;
      is_default?: boolean;
      is_final?: boolean;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      color?: string;
      is_default?: boolean;
      is_final?: boolean;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}

@Controller('detection-sources')
@UseGuards(JwtAuthGuard)
export class DetectionSourcesController {
  constructor(private readonly service: DetectionSourcesService) {}

  @Get()
  findAll(@Query('include_inactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      code?: string;
      description?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      description?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}

@Controller('detected-crimes')
@UseGuards(JwtAuthGuard)
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
    return this.service.findAll(
      {
        page: Number(page) || 1,
        limit: Number(limit) || 15,
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
  getByCitizen(@Param('citizenId', ParseUUIDPipe) citizenId: string) {
    return this.service.findByCitizenId(citizenId);
  }

  @Get('citizen/:citizenId/repeat-check')
  checkRepeat(
    @Param('citizenId', ParseUUIDPipe) citizenId: string,
    @Query('exclude_id') excludeId?: string,
  ) {
    return this.service.checkCitizenRepeatHistory(citizenId, excludeId);
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
  create(@Body() body: SaveDetectedCrimeInput, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.service.create(body, currentUser);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<SaveDetectedCrimeInput>,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.update(id, body, currentUser);
  }

  @Post(':id/extend-deadline')
  extendDeadline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { extend_days?: number; reason: string; prosecutor_approval_number?: string },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.service.extendDeadline(id, body, currentUser);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.service.remove(id, currentUser);
  }
}
