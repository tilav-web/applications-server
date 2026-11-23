import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { ApplicationStatusCategory } from '../application-status.entity';

export class CreateApplicationStatusDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ApplicationStatusCategory)
  category?: ApplicationStatusCategory;

  @IsOptional()
  @IsBoolean()
  tracks_sla?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  default_sla_days?: number | null;

  @IsOptional()
  @IsString()
  legal_article?: string | null;

  @IsOptional()
  @IsBoolean()
  requires_decision?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_rejection_reason?: boolean;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
