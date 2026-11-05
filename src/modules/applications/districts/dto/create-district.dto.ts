import { IsOptional, IsString } from 'class-validator';

export class CreateDistrictDto {
  @IsOptional()
  @IsString()
  name?: string;
}
