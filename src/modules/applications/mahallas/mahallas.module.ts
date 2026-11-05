import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { District } from '../districts/district.entity';
import { Mahalla } from './mahalla.entity';
import { MahallasController } from './mahallas.controller';
import { MahallasService } from './mahallas.service';

@Module({
  imports: [TypeOrmModule.forFeature([Mahalla, District]), AuthModule],
  controllers: [MahallasController],
  providers: [MahallasService],
  exports: [MahallasService, TypeOrmModule],
})
export class MahallasModule {}
