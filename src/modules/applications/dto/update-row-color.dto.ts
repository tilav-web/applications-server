import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

import { ALLOWED_ROW_COLORS, type ApplicationRowColor } from '../applications-realtime.service';

export class UpdateRowColorDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @IsString({ message: 'Rang matn ko‘rinishida bo‘lishi kerak' })
  @IsIn(ALLOWED_ROW_COLORS, {
    message: `Ruxsat etilgan ranglar: ${ALLOWED_ROW_COLORS.join(', ')}`,
  })
  row_color?: ApplicationRowColor | null;
}

export class BulkUpdateRowColorDto {
  @IsArray({ message: 'Arizalar ID ro‘yxati massiv bo‘lishi kerak' })
  @ArrayMinSize(1, { message: 'Kamida bitta ariza tanlanishi shart' })
  @IsUUID('all', { each: true, message: 'Ariza ID formati noto‘g‘ri' })
  ids: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @IsString({ message: 'Rang matn ko‘rinishida bo‘lishi kerak' })
  @IsIn(ALLOWED_ROW_COLORS, {
    message: `Ruxsat etilgan ranglar: ${ALLOWED_ROW_COLORS.join(', ')}`,
  })
  row_color?: ApplicationRowColor | null;
}
