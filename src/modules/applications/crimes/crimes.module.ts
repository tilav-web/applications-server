import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { Crime } from './crime.entity';
import { CrimesController } from './crimes.controller';
import { CrimesService } from './crimes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Crime]), AuthModule],
  controllers: [CrimesController],
  providers: [CrimesService],
  exports: [CrimesService],
})
export class CrimesModule {}
