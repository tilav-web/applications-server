import {
  BadRequestException,
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
import {
  AddCardToCitizenDto,
  AddIdentifierToCitizenDto,
  AddPhoneToCitizenDto,
  BindEntityToCitizenDto,
  ConfirmProbableMatchDto,
  CreateTransitTransferDto,
  LinkCitizenRoleDto,
} from './dto/intelligence.dto';
import { IntelligenceService } from './intelligence.service';
import { IntelligenceExportService } from './intelligence-export.service';
import { IntelligenceSyncService } from './intelligence-sync.service';

const READ_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.BOSS,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
];

const WRITE_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
];

@Controller('intelligence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...READ_ROLES)
export class IntelligenceController {
  constructor(
    private readonly intelligenceService: IntelligenceService,
    private readonly exportService: IntelligenceExportService,
    private readonly syncService: IntelligenceSyncService,
  ) {}

  @Get('search')
  globalSearch(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: number,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const { limit: safeLimit } = normalizePagination(1, limit, 30, 100);
    return this.intelligenceService.globalSearch(q || '', category, safeLimit, currentUser);
  }

  @Get('radar')
  checkRadar(
    @Query('type') type?: string,
    @Query('value') value?: string,
    @Query('excludeAppId') excludeAppId?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.checkRadar(
      type || 'other_info',
      value || '',
      excludeAppId,
      currentUser,
    );
  }

  @Get('expand-node')
  expandNode(
    @Query('nodeType') nodeType?: string,
    @Query('entityId') entityId?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    if (!nodeType || !entityId) {
      throw new BadRequestException('nodeType va entityId koʻrsatilishi shart');
    }
    return this.intelligenceService.expandGraphNode(nodeType, entityId, currentUser);
  }

  @Post('sync')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  resyncAll() {
    return this.syncService.syncAllExistingData();
  }

  // ===========================================================================
  // 360° DOSYELAR
  // ===========================================================================

  @Get('dossier/citizen/:id')
  getCitizenDossier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.getCitizenDossier(id, currentUser);
  }

  @Get('dossier/card/:id')
  getCardDossier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.getCardDossier(id, currentUser);
  }

  @Get('dossier/phone/:id')
  getPhoneDossier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.getPhoneDossier(id, currentUser);
  }

  @Get('dossier/identifier/:id')
  getIdentifierDossier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.getIdentifierDossier(id, currentUser);
  }

  // ===========================================================================
  // DOSYE EKSPORTLARI (EXCEL .XLSX VA WORD .DOCX)
  // ===========================================================================

  @Get('dossier/:entityType/:id/export/:format')
  async exportDossier(
    @Param('entityType') entityType: 'citizen' | 'card' | 'phone' | 'identifier',
    @Param('id', ParseUUIDPipe) id: string,
    @Param('format') format: 'excel' | 'docx',
    @Res() res: Response,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    let dossier;
    if (entityType === 'citizen') {
      dossier = await this.intelligenceService.getCitizenDossier(id, currentUser);
    } else if (entityType === 'card') {
      dossier = await this.intelligenceService.getCardDossier(id, currentUser);
    } else if (entityType === 'phone') {
      dossier = await this.intelligenceService.getPhoneDossier(id, currentUser);
    } else {
      dossier = await this.intelligenceService.getIdentifierDossier(id, currentUser);
    }

    if (format === 'docx') {
      return this.exportService.exportDocx(dossier, res);
    }
    return this.exportService.exportExcel(dossier, res);
  }

  // ===========================================================================
  // REKVIZITLAR QO'SHISH, BIRIKTIRISH VA TRANZIT O'TKAZMALAR
  // ===========================================================================

  @Post('dossier/citizen/:id/phones')
  @Roles(...WRITE_ROLES)
  addPhoneToCitizen(
    @Param('id', ParseUUIDPipe) citizenId: string,
    @Body() body: AddPhoneToCitizenDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.addPhoneToCitizen(citizenId, body, currentUser);
  }

  @Delete('phones/:phoneId')
  @Roles(...WRITE_ROLES)
  removePhone(
    @Param('phoneId', ParseUUIDPipe) phoneId: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.removePhoneFromCitizen(phoneId, currentUser);
  }

  @Post('dossier/citizen/:id/cards')
  @Roles(...WRITE_ROLES)
  addCardToCitizen(
    @Param('id', ParseUUIDPipe) citizenId: string,
    @Body() body: AddCardToCitizenDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.addCardToCitizen(citizenId, body, currentUser);
  }

  @Patch('cards/:cardId/unlink-citizen')
  @Roles(...WRITE_ROLES)
  unlinkCardFromCitizen(
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.unlinkCardFromCitizen(cardId, currentUser);
  }

  @Post('dossier/citizen/:id/identifiers')
  @Roles(...WRITE_ROLES)
  addIdentifierToCitizen(
    @Param('id', ParseUUIDPipe) citizenId: string,
    @Body() body: AddIdentifierToCitizenDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.addIdentifierToCitizen(citizenId, body, currentUser);
  }

  @Delete('identifiers/:identifierId')
  @Roles(...WRITE_ROLES)
  removeIdentifier(
    @Param('identifierId', ParseUUIDPipe) identifierId: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.removeIdentifierFromCitizen(identifierId, currentUser);
  }

  @Post('bind-to-citizen')
  @Roles(...WRITE_ROLES)
  bindEntityToCitizen(
    @Body() body: BindEntityToCitizenDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.bindEntityToCitizen(body, currentUser);
  }

  @Post('transfers/transit')
  @Roles(...WRITE_ROLES)
  createTransitTransfer(
    @Body() body: CreateTransitTransferDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.createTransitTransfer(body, currentUser);
  }

  @Post('application-role-link')
  @Roles(...WRITE_ROLES)
  linkCitizenRoleToApplication(
    @Body() body: LinkCitizenRoleDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.linkCitizenRoleToApplication(body, currentUser);
  }

  @Post('confirm-match')
  @Roles(...WRITE_ROLES)
  confirmProbableMatch(
    @Body() body: ConfirmProbableMatchDto,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.confirmProbableMatch(body, currentUser);
  }
}
