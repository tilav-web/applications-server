import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { TransferCustomFieldType } from '../../../../common/enums/transfer-custom-field-type.enum';
import { TransferStatus } from '../../../../common/enums/transfer-status.enum';

export class CreateTransferCustomFieldDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsEnum(TransferCustomFieldType)
  type?: TransferCustomFieldType;

  @IsOptional()
  value?: unknown;

  @IsOptional()
  @IsUUID('4')
  card_id?: string;

  @IsOptional()
  @IsUUID('4')
  citizen_id?: string;

  @IsOptional()
  @IsUUID('4')
  bank_id?: string;

  @IsOptional()
  @IsUUID('4')
  payment_provider_id?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

export class CreateTransferDto {
  @IsOptional()
  @IsString()
  transaction_id?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  @IsOptional()
  @IsUUID('4')
  application_id?: string;

  @IsOptional()
  @IsUUID('4')
  payment_provider_id?: string;

  @IsOptional()
  @IsUUID('4')
  sender_card_id?: string;

  @IsOptional()
  @IsUUID('4')
  receiver_card_id?: string;

  @IsOptional()
  @IsUUID('4')
  card_id?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransferCustomFieldDto)
  custom_fields?: CreateTransferCustomFieldDto[];
}
