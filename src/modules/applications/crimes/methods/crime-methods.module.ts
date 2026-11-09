import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../../auth/auth.module';
import { CrimeMethod } from './crime-method.entity';
import { CrimeMethodsController } from './crime-methods.controller';
import { CrimeMethodsService } from './crime-methods.service';

@Module({
  imports: [TypeOrmModule.forFeature([CrimeMethod]), AuthModule],
  controllers: [CrimeMethodsController],
  providers: [CrimeMethodsService],
  exports: [CrimeMethodsService],
})
export class CrimeMethodsModule {}
