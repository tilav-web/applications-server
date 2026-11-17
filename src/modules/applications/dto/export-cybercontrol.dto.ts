import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ExportCyberControlDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Kamida bitta murojaat tanlanishi shart' })
  @IsUUID('all', { each: true, message: 'Murojaat ID formati noto‘g‘ri' })
  ids: string[];
}
