import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Application } from '../applications/application.entity';
import { Bank } from '../applications/transfers/banks/bank.entity';
import { Card } from '../applications/transfers/cards/card.entity';
import { Transfer } from '../applications/transfers/transfer.entity';
import { AuthModule } from '../auth/auth.module';
import { FinancialFlowController } from './financial-flow.controller';
import { FinancialFlowService } from './financial-flow.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Card, Transfer, Application, Bank]),
    AuthModule,
  ],
  controllers: [FinancialFlowController],
  providers: [FinancialFlowService],
  exports: [FinancialFlowService],
})
export class FinancialFlowModule {}

