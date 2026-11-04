import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateBankDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  mfo?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
