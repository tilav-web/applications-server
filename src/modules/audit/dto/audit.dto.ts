import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsIP, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateAuditSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(3650)
  audit_retention_days?: number;

  @IsOptional()
  @IsBoolean()
  audit_archive_to_minio?: boolean;
}

export class BlockIpDto {
  @IsIP(undefined, { message: "IP manzil formati noto'g'ri" })
  ip: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  duration_hours?: number;
}
