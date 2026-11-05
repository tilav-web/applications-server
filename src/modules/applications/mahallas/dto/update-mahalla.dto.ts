import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateMahallaDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Tuman ID to‘g‘ri formatda bo‘lishi kerak' })
  district_id?: string;
}
