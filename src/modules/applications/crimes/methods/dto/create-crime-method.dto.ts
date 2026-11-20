import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import type { CrimeMethodFieldType } from '../crime-method-field.entity';

export class CrimeMethodFieldDto {
  @IsOptional()
  @IsString()
  key?: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsIn(['STRING', 'NUMBER', 'URL', 'DATE', 'PHONE', 'TEXT', 'SELECT'])
  field_type?: CrimeMethodFieldType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  placeholder?: string;

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @IsOptional()
  @IsBoolean()
  show_in_excel?: boolean;

  @IsOptional()
  @IsString()
  excel_header?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateCrimeMethodDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  group_name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  /**
   * Bog'lanadigan jinoyat turlari ID lari. Bo'sh bo'lsa — barcha jinoyat turlari uchun umumiy.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  crime_ids?: string[];

  /**
   * Ushbu usulga biriktiriladigan dinamik maydonlar (APK, Telegram, havola va h.k.)
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrimeMethodFieldDto)
  fields?: CrimeMethodFieldDto[];
}
