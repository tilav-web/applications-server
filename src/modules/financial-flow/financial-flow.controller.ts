import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { FinancialFlowService } from './financial-flow.service';

@Controller('financial-flow')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.BOSS,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
)
export class FinancialFlowController {
  constructor(private readonly flowService: FinancialFlowService) {}

  @Get('graph')
  getNetworkGraph(
    @Query('searchCard') searchCard?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('minAmount') minAmount?: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.flowService.getNetworkGraph(
      {
        searchCard,
        riskLevel,
        minAmount: minAmount ? Number(minAmount) : undefined,
      },
      currentUser,
    );
  }

  @Get('card/:cardNumber')
  getCardDetails(
    @Param('cardNumber') cardNumber: string,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    return this.flowService.getCardDetails(cardNumber, currentUser);
  }
}
