import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { MinioController } from './minio.controller';
import { MinioService } from './minio.service';

@Module({
  imports: [ConfigModule, forwardRef(() => AuthModule)],
  controllers: [MinioController],
  providers: [MinioService],
  exports: [MinioService],
})
export class MinioModule {}
