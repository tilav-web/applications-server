import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateMahallaDto {
  @IsNotEmpty({ message: 'Mahalla nomi bo‘sh bo‘lishi mumkin emas' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Tuman ID kiritilishi shart' })
  @IsUUID('4', { message: 'Tuman ID to‘g‘ri formatda bo‘lishi kerak' })
  district_id: string;
}
