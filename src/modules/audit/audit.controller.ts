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
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { type AuditLogQuery, AuditService } from './audit.service';
import { BlockIpDto, UpdateAuditSettingsDto } from './dto/audit.dto';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  getLogs(@Query() query: AuditLogQuery) {
    return this.auditService.getLogs(query);
  }

  @Get('stats')
  getStats() {
    return this.auditService.getStats();
  }

  @Get('export/excel')
  exportExcel(@Query() query: AuditLogQuery, @Res() res: Response) {
    return this.auditService.exportLogsToExcel(query, res);
  }

  @Get('settings')
  getSettings() {
    return this.auditService.getSettings();
  }

  @Patch('settings')
  updateSettings(
    @Body() body: UpdateAuditSettingsDto,
    @CurrentUser() currentUser: JwtAccessPayload,
  ) {
    return this.auditService.updateSettings(body, currentUser);
  }

  @Post('cleanup')
  runCleanup(@CurrentUser() currentUser: JwtAccessPayload) {
    return this.auditService.runRetentionCleanup(currentUser);
  }

  @Get('traffic')
  getTrafficOverview() {
    return this.auditService.getTrafficOverview();
  }

  @Post('traffic/block-ip')
  blockIp(@Body() body: BlockIpDto, @CurrentUser() currentUser: JwtAccessPayload) {
    return this.auditService.blockIp(
      body.ip,
      body.reason || 'Super Admin tomonidan bloklandi',
      body.duration_hours || 24,
      currentUser,
    );
  }

  @Delete('traffic/block-ip/:ip')
  unblockIp(@Param('ip') ip: string, @CurrentUser() currentUser: JwtAccessPayload) {
    return this.auditService.unblockIp(ip, currentUser);
  }
}
