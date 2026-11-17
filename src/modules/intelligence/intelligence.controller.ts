import {
  BadRequestException,
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
import type { EntityLinkRole } from './entities/entity-application-link.entity';
import { IntelligenceService } from './intelligence.service';
import { IntelligenceExportService } from './intelligence-export.service';
import { IntelligenceSyncService } from './intelligence-sync.service';

@Controller('intelligence')
@UseGuards(JwtAuthGuard)
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
    return this.intelligenceService.globalSearch(
      q || '',
      category,
      Number(limit) || 30,
      currentUser,
    );
  }

  @Get('radar')
  checkRadar(
    @Query('type') type?: string,
    @Query('value') value?: string,
    @Query('excludeAppId') excludeAppId?: string,
  ) {
    return this.intelligenceService.checkRadar(type || 'other_info', value || '', excludeAppId);
  }

  @Get('expand-node')
  expandNode(@Query('nodeType') nodeType?: string, @Query('entityId') entityId?: string) {
    if (!nodeType || !entityId) {
      throw new BadRequestException('nodeType va entityId koʻrsatilishi shart');
    }
    return this.intelligenceService.expandGraphNode(nodeType, entityId);
  }

  @Post('sync')
  resyncAll() {
    return this.syncService.syncAllExistingData();
  }

  // ===========================================================================
  // 360° DOSYELAR
  // ===========================================================================

  @Get('dossier/citizen/:id')
  getCitizenDossier(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.intelligenceService.getCitizenDossier(id, currentUser);
  }

  @Get('dossier/card/:id')
  getCardDossier(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.intelligenceService.getCardDossier(id, currentUser);
  }

  @Get('dossier/phone/:id')
  getPhoneDossier(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.intelligenceService.getPhoneDossier(id, currentUser);
  }

  @Get('dossier/identifier/:id')
  getIdentifierDossier(@Param('id') id: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.intelligenceService.getIdentifierDossier(id, currentUser);
  }

  // ===========================================================================
  // DOSYE EKSPORTLARI (EXCEL .XLSX VA WORD .DOCX)
  // ===========================================================================

  @Get('dossier/:entityType/:id/export/:format')
  async exportDossier(
    @Param('entityType') entityType: 'citizen' | 'card' | 'phone' | 'identifier',
    @Param('id') id: string,
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
  addPhoneToCitizen(
    @Param('id') citizenId: string,
    @Body() body: { phone_number: string; label?: string; notes?: string; is_primary?: boolean },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.addPhoneToCitizen(citizenId, body, currentUser);
  }

  @Delete('phones/:phoneId')
  removePhone(@Param('phoneId') phoneId: string, @CurrentUser() currentUser?: JwtAccessPayload) {
    return this.intelligenceService.removePhoneFromCitizen(phoneId, currentUser);
  }

  @Post('dossier/citizen/:id/cards')
  addCardToCitizen(
    @Param('id') citizenId: string,
    @Body()
    body: {
      card_number: string;
      expire_date?: string;
      bank_id?: string;
      bank_name?: string;
      full_name?: string;
    },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.addCardToCitizen(citizenId, body, currentUser);
  }

  @Patch('cards/:cardId/unlink-citizen')
  unlinkCardFromCitizen(
    @Param('cardId') cardId: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.unlinkCardFromCitizen(cardId, currentUser);
  }

  @Post('dossier/citizen/:id/identifiers')
  addIdentifierToCitizen(
    @Param('id') citizenId: string,
    @Body() body: { type: string; value: string; type_label?: string; notes?: string },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.addIdentifierToCitizen(citizenId, body, currentUser);
  }

  @Delete('identifiers/:identifierId')
  removeIdentifier(
    @Param('identifierId') identifierId: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.removeIdentifierFromCitizen(identifierId, currentUser);
  }

  @Post('bind-to-citizen')
  bindEntityToCitizen(
    @Body()
    body: {
      entity_type: 'card' | 'phone' | 'identifier';
      entity_id: string;
      citizen_id: string;
    },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.bindEntityToCitizen(body, currentUser);
  }

  @Post('transfers/transit')
  createTransitTransfer(
    @Body()
    body: {
      sender_card_id?: string;
      sender_card_number?: string;
      sender_owner_name?: string;
      receiver_card_id?: string;
      receiver_card_number?: string;
      receiver_owner_name?: string;
      amount: number;
      currency?: string;
      transfer_date?: string;
      transfer_time?: string;
      payment_provider_id?: string;
      payment_provider_name?: string;
      transaction_id?: string;
      application_id?: string;
    },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.createTransitTransfer(body, currentUser);
  }

  @Post('application-role-link')
  linkCitizenRoleToApplication(
    @Body()
    body: {
      application_id: string;
      citizen_id: string;
      role: EntityLinkRole;
      note?: string;
    },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.linkCitizenRoleToApplication(body, currentUser);
  }

  @Post('confirm-match')
  confirmProbableMatch(
    @Body() body: { citizen_id: string; card_id: string },
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.intelligenceService.confirmProbableMatch(body, currentUser);
  }
}
