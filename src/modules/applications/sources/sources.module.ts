import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { ApplicationSource } from './application-source.entity';
import { ApplicationSourcesController } from './sources.controller';
import { ApplicationSourcesService } from './sources.service';

@Module({
  imports: [TypeOrmModule.forFeature([ApplicationSource]), AuthModule],
  controllers: [ApplicationSourcesController],
  providers: [ApplicationSourcesService],
  exports: [ApplicationSourcesService, TypeOrmModule],
})
export class ApplicationSourcesModule {}
