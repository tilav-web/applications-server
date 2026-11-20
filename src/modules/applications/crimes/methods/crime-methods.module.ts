import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../../auth/auth.module';
import { Crime } from '../crime.entity';
import { CrimeMethod } from './crime-method.entity';
import { CrimeMethodField } from './crime-method-field.entity';
import { CrimeMethodsController } from './crime-methods.controller';
import { CrimeMethodsService } from './crime-methods.service';

@Module({
  imports: [TypeOrmModule.forFeature([CrimeMethod, CrimeMethodField, Crime]), AuthModule],
  controllers: [CrimeMethodsController],
  providers: [CrimeMethodsService],
  exports: [CrimeMethodsService],
})
export class CrimeMethodsModule {}
