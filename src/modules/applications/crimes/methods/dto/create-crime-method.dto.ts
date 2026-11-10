import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

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
}
