import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../../auth/auth.module';
import { TransferChannel } from './transfer-channel.entity';
import { TransferChannelsController } from './transfer-channels.controller';
import { TransferChannelsService } from './transfer-channels.service';

@Module({
  imports: [TypeOrmModule.forFeature([TransferChannel]), AuthModule],
  controllers: [TransferChannelsController],
  providers: [TransferChannelsService],
  exports: [TransferChannelsService],
})
export class TransferChannelsModule {}
