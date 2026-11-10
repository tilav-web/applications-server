import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
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
  async getOperationalMatrix(@Query() dto: OperationalMatrixQueryDto) {
    return this.reportsService.getOperationalMatrix(dto);
  }

  @Get('operational-matrix/export')
  async exportOperationalMatrixExcel(
    @Query() dto: OperationalMatrixQueryDto,
    @Res() res: Response,
  ) {
    const workbook = await this.reportsService.exportOperationalMatrixExcel(dto);
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
  async getDepartmentServices(@Query() dto: DepartmentServicesQueryDto) {
    return this.reportsService.getDepartmentServices(dto);
  }

  @Get('department-services/export')
  async exportDepartmentServicesExcel(
    @Query() dto: DepartmentServicesQueryDto,
    @Res() res: Response,
  ) {
    const workbook = await this.reportsService.exportDepartmentServicesExcel(dto);
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
  async getRegistryReport(@Query() dto: RegistryReportQueryDto) {
    return this.reportsService.getRegistryReport(dto);
  }

  @Get('registry/export')
  async exportRegistryExcel(@Query() dto: RegistryReportQueryDto, @Res() res: Response) {
    const workbook = await this.reportsService.exportRegistryExcel(dto);
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
