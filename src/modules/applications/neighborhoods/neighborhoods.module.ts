import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { District } from '../districts/district.entity';
import { Neighborhood } from './neighborhood.entity';
import { NeighborhoodsController } from './neighborhoods.controller';
import { NeighborhoodsService } from './neighborhoods.service';

@Module({
  imports: [TypeOrmModule.forFeature([Neighborhood, District]), AuthModule],
  controllers: [NeighborhoodsController],
  providers: [NeighborhoodsService],
  exports: [NeighborhoodsService, TypeOrmModule],
})
export class NeighborhoodsModule {}
