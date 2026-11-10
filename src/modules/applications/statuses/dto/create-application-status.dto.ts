import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

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
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
