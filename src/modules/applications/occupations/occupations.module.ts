import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { Occupation } from './occupation.entity';
import { OccupationCategory } from './occupation-category.entity';
import { OccupationsController } from './occupations.controller';
import { OccupationsService } from './occupations.service';

@Module({
  imports: [TypeOrmModule.forFeature([OccupationCategory, Occupation]), AuthModule],
  controllers: [OccupationsController],
  providers: [OccupationsService],
  exports: [OccupationsService, TypeOrmModule],
})
export class OccupationsModule {}
