import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { ApplicationStatus } from '../../../common/enums/application-status.enum';
import { CustomFieldType } from '../../../common/enums/custom-field-type.enum';

export class CreateApplicationCustomFieldDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsEnum(CustomFieldType)
  type?: CustomFieldType;

  @IsOptional()
  value?: unknown;

  // Sub-model Foreign Keys
  @IsOptional()
  @IsUUID('4')
  citizen_id?: string;

  @IsOptional()
  @IsUUID('4')
  card_id?: string;

  @IsOptional()
  @IsUUID('4')
  crime_id?: string;

  @IsOptional()
  @IsUUID('4')
  district_id?: string;

  @IsOptional()
  @IsUUID('4')
  transfer_id?: string;

  // Inline yangi yaratish uchun ma'lumotlar
  @IsOptional()
  @IsObject()
  inline_citizen?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_card?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_crime?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_district?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_transfer?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  order?: number;
}

export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  application_number?: string | null;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsDateString()
  date?: string;

  // Birlamchi Asosiy Modellar (Har biridan bittadan ManyToOne)
  @IsOptional()
  @IsUUID('4')
  citizen_id?: string;

  @IsOptional()
  @IsObject()
  citizen_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  crime_id?: string;

  @IsOptional()
  @IsObject()
  crime_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  district_id?: string;

  @IsOptional()
  @IsObject()
  district_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  card_id?: string;

  @IsOptional()
  @IsObject()
  card_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  transfer_id?: string;

  @IsOptional()
  @IsObject()
  transfer_data?: Record<string, unknown>;

  // Yagona massiv: Dinamik Custom Fields
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApplicationCustomFieldDto)
  custom_fields?: CreateApplicationCustomFieldDto[];
}
