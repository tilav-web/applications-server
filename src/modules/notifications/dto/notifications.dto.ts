import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateNotificationPrefsDto {
  @IsOptional()
  @IsBoolean()
  telegram_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  high_value?: boolean;

  @IsOptional()
  @IsBoolean()
  cross_case?: boolean;

  @IsOptional()
  @IsBoolean()
  sla?: boolean;

  @IsOptional()
  @IsBoolean()
  new_application?: boolean;

  @IsOptional()
  @IsBoolean()
  status_changed?: boolean;

  @IsOptional()
  @IsBoolean()
  daily_digest?: boolean;
}

export class UpdateAdminRulesDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  high_value_threshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  sla_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  sla_warn_hours_before?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  sla_urgent_hours_before?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  sla_escalate_hours_after?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  sla_max_extension_days?: number;

  @IsOptional()
  @IsBoolean()
  daily_digest_enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  daily_digest_hour?: number;
}

export class ConfigureTelegramBotDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ToggleTelegramBotDto {
  @IsBoolean()
  enabled: boolean;
}
