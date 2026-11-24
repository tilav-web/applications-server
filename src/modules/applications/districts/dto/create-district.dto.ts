import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateDistrictDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Viloyat ID to‘g‘ri formatda bo‘lishi kerak' })
  region_id?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Kenglik (latitude) raqam bo‘lishi kerak' })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Uzunlik (longitude) raqam bo‘lishi kerak' })
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}
