import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../../auth/auth.module';
import { Card } from './card.entity';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { CardsExcelService } from './export/cards-excel.service';

@Module({
  imports: [TypeOrmModule.forFeature([Card]), AuthModule],
  controllers: [CardsController],
  providers: [CardsService, CardsExcelService],
  exports: [CardsService, CardsExcelService],
})
export class CardsModule {}
