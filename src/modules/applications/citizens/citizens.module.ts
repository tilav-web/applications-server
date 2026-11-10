import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { Citizen } from './citizen.entity';
import { CitizensController } from './citizens.controller';
import { CitizensService } from './citizens.service';
import { CitizensExcelService } from './export/citizens-excel.service';

@Module({
  imports: [TypeOrmModule.forFeature([Citizen]), AuthModule],
  controllers: [CitizensController],
  providers: [CitizensService, CitizensExcelService],
  exports: [CitizensService, CitizensExcelService],
})
export class CitizensModule {}
