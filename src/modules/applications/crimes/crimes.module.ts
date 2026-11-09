import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { Crime } from './crime.entity';
import { CrimesController } from './crimes.controller';
import { CrimesService } from './crimes.service';
import { CrimeMethod } from './methods/crime-method.entity';
import { CrimeMethodsModule } from './methods/crime-methods.module';

@Module({
  imports: [TypeOrmModule.forFeature([Crime, CrimeMethod]), AuthModule, CrimeMethodsModule],
  controllers: [CrimesController],
  providers: [CrimesService],
  exports: [CrimesService, CrimeMethodsModule],
})
export class CrimesModule {}
