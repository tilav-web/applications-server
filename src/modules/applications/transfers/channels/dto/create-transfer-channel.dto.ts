import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

import { TransferDestinationType } from '../../../../../common/enums/transfer-destination-type.enum';

export class CreateTransferChannelDto {
  @IsNotEmpty({ message: 'Kanal nomi majburiy' })
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(TransferDestinationType)
  category?: TransferDestinationType;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  presets?: string[];

  @IsOptional()
  @IsString()
  platform_label?: string;

  @IsOptional()
  @IsString()
  platform_placeholder?: string;

  @IsOptional()
  @IsString()
  value_label?: string;

  @IsOptional()
  @IsString()
  value_placeholder?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
