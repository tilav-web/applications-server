import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { Citizen } from './citizen.entity';
import { CitizensController } from './citizens.controller';
import { CitizensService } from './citizens.service';

@Module({
  imports: [TypeOrmModule.forFeature([Citizen]), AuthModule],
  controllers: [CitizensController],
  providers: [CitizensService],
  exports: [CitizensService],
})
export class CitizensModule {}
