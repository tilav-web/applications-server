import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FinancialFlowService } from './financial-flow.service';

@Controller('financial-flow')
@UseGuards(JwtAuthGuard)
export class FinancialFlowController {
  constructor(private readonly flowService: FinancialFlowService) {}

  @Get('graph')
  getNetworkGraph(
    @Query('searchCard') searchCard?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('minAmount') minAmount?: string,
  ) {
    return this.flowService.getNetworkGraph({
      searchCard,
      riskLevel,
      minAmount: minAmount ? Number(minAmount) : undefined,
    });
  }

  @Get('card/:cardNumber')
  getCardDetails(@Param('cardNumber') cardNumber: string) {
    return this.flowService.getCardDetails(cardNumber);
  }
}
