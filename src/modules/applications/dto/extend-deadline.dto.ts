import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ExtendDeadlineDto {
  @IsOptional()
  @IsDateString()
  new_deadline_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  extend_days?: number;

  @IsString()
  @IsNotEmpty({ message: 'Muddatni uzaytirish sababi kiritilishi shart' })
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  prosecutor_approval_number?: string;

  @IsOptional()
  @IsDateString()
  prosecutor_approval_date?: string;

  @IsOptional()
  @IsBoolean()
  switch_to_extended_status?: boolean;
}
