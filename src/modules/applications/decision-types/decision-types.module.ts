import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DecisionType } from './decision-type.entity';
import { DecisionTypesController } from './decision-types.controller';
import { DecisionTypesService } from './decision-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([DecisionType]), AuthModule],
  controllers: [DecisionTypesController],
  providers: [DecisionTypesService],
  exports: [DecisionTypesService, TypeOrmModule],
})
export class DecisionTypesModule {}
