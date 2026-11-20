import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { TransferCustomFieldType } from '../../../../common/enums/transfer-custom-field-type.enum';
import { TransferDestinationType } from '../../../../common/enums/transfer-destination-type.enum';
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
  @IsString()
  transfer_date?: string;

  @IsOptional()
  @IsString()
  transfer_time?: string;

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
  @IsEnum(TransferDestinationType)
  destination_type?: TransferDestinationType;

  @IsOptional()
  @IsUUID('4')
  receiver_identifier_id?: string;

  @IsOptional()
  @IsString()
  destination_platform?: string;

  @IsOptional()
  @IsString()
  destination_value?: string;

  @IsOptional()
  @IsString()
  destination_label?: string;

  @IsOptional()
  @IsObject()
  destination_details?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransferCustomFieldDto)
  custom_fields?: CreateTransferCustomFieldDto[];
}
