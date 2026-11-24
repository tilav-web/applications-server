import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class UpdateNeighborhoodDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Tuman ID to‘g‘ri formatda bo‘lishi kerak' })
  district_id?: string;

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
