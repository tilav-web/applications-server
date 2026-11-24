import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { District } from '../districts/district.entity';
import { DistrictsModule } from '../districts/districts.module';
import { Occupation } from '../occupations/occupation.entity';
import { OccupationCategory } from '../occupations/occupation-category.entity';
import { OccupationsModule } from '../occupations/occupations.module';
import { Workplace } from './workplace.entity';
import { WorkplacesController } from './workplaces.controller';
import { WorkplacesService } from './workplaces.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workplace, District, Occupation, OccupationCategory]),
    AuthModule,
    DistrictsModule,
    OccupationsModule,
  ],
  controllers: [WorkplacesController],
  providers: [WorkplacesService],
  exports: [WorkplacesService, TypeOrmModule],
})
export class WorkplacesModule {}
