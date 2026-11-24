import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DigitalIdentifierEntity } from '../../intelligence/entities/digital-identifier.entity';
import { User } from '../../users/user.entity';
import { TransferCustomField } from './custom-fields/transfer-custom-field.entity';
import { TransfersExcelService } from './export/transfers-excel.service';
import { Transfer } from './transfer.entity';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer, TransferCustomField, DigitalIdentifierEntity, User]),
    AuthModule,
  ],
  controllers: [TransfersController],
  providers: [TransfersService, TransfersExcelService],
  exports: [TransfersService, TransfersExcelService],
})
export class TransfersModule {}
