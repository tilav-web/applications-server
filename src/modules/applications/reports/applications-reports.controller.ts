import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import { ApplicationsReportsService } from './applications-reports.service';
import {
  DepartmentServicesQueryDto,
  OperationalMatrixQueryDto,
  RegistryReportQueryDto,
} from './dto/report-query.dto';

@Controller('applications/reports')
@UseGuards(JwtAuthGuard)
export class ApplicationsReportsController {
  constructor(private readonly reportsService: ApplicationsReportsService) {}

  @Get('operational-matrix')
  async getOperationalMatrix(
    @Query() dto: OperationalMatrixQueryDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.reportsService.getOperationalMatrix(dto, currentUser);
  }

  @Get('operational-matrix/export')
  async exportOperationalMatrixExcel(
    @Query() dto: OperationalMatrixQueryDto,
    @Res() res: Response,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const workbook = await this.reportsService.exportOperationalMatrixExcel(dto, currentUser);
    const dateStr = dto.date || new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="viloyat_tezkor_svodkasi_${dateStr}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  }

  @Get('department-services')
  async getDepartmentServices(
    @Query() dto: DepartmentServicesQueryDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.reportsService.getDepartmentServices(dto, currentUser);
  }

  @Get('department-services/export')
  async exportDepartmentServicesExcel(
    @Query() dto: DepartmentServicesQueryDto,
    @Res() res: Response,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const workbook = await this.reportsService.exportDepartmentServicesExcel(dto, currentUser);
    const dateStr = dto.date || new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sohaviy_xizmatlar_tahlili_${dateStr}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  }

  @Get('registry')
  async getRegistryReport(
    @Query() dto: RegistryReportQueryDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.reportsService.getRegistryReport(dto, currentUser);
  }

  @Get('registry/export')
  async exportRegistryExcel(
    @Query() dto: RegistryReportQueryDto,
    @Res() res: Response,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const workbook = await this.reportsService.exportRegistryExcel(dto, currentUser);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="batafsil_analitik_reestr_${dateStr}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  }
}
