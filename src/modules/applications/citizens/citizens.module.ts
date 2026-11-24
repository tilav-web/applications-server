import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { User } from '../../users/user.entity';
import { Citizen } from './citizen.entity';
import { CitizensController } from './citizens.controller';
import { CitizensService } from './citizens.service';
import { CitizensExcelService } from './export/citizens-excel.service';

@Module({
  imports: [TypeOrmModule.forFeature([Citizen, User]), AuthModule],
  controllers: [CitizensController],
  providers: [CitizensService, CitizensExcelService],
  exports: [CitizensService, CitizensExcelService],
})
export class CitizensModule {}
