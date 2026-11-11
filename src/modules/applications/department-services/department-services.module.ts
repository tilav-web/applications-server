import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DepartmentService } from './department-service.entity';
import { DepartmentServicesController } from './department-services.controller';
import { DepartmentServicesService } from './department-services.service';

@Module({
  imports: [TypeOrmModule.forFeature([DepartmentService]), AuthModule],
  controllers: [DepartmentServicesController],
  providers: [DepartmentServicesService],
  exports: [DepartmentServicesService, TypeOrmModule],
})
export class DepartmentServicesModule {}
