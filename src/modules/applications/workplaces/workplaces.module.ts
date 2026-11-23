import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { Workplace } from './workplace.entity';
import { WorkplacesController } from './workplaces.controller';
import { WorkplacesService } from './workplaces.service';

@Module({
  imports: [TypeOrmModule.forFeature([Workplace]), AuthModule],
  controllers: [WorkplacesController],
  providers: [WorkplacesService],
  exports: [WorkplacesService, TypeOrmModule],
})
export class WorkplacesModule {}
