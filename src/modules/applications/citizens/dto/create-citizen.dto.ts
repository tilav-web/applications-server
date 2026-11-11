import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';

export class CreateCitizenDto {
  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  middle_name?: string;

  @IsOptional()
  @ValidateIf((o: CreateCitizenDto) => Boolean(o.passport && o.passport.trim() !== ''))
  @IsString()
  @Length(9, 9, {
    message: "Pasport seriyasi va raqami 9 ta belgidan iborat bo'lishi kerak (masalan: AC1234567)",
  })
  @Matches(/^[A-Za-z]{2}\d{7}$/, {
    message: "Pasport formati to'g'ri emas (masalan: AC1234567)",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== ''
      ? value.replace(/\s+/g, '').toUpperCase()
      : null,
  )
  passport?: string | null;

  @IsOptional()
  @ValidateIf((o: CreateCitizenDto) => Boolean(o.pinfl && o.pinfl.trim() !== ''))
  @IsString()
  @Length(14, 14, { message: "JShShIR (PINFL) 14 ta raqam bo'lishi kerak" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null,
  )
  pinfl?: string | null;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @ValidateIf((o: CreateCitizenDto) => Boolean(o.birth_date && o.birth_date.trim() !== ''))
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null,
  )
  birth_date?: string | null;

  @IsOptional()
  @ValidateIf((o: CreateCitizenDto) => Boolean(o.gender && o.gender.trim() !== ''))
  @IsIn(['male', 'female'], { message: "Jinsi faqat 'male' yoki 'female' bo'lishi mumkin" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null,
  )
  gender?: 'male' | 'female' | null;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  district_id?: string | null;

  @IsOptional()
  @IsString()
  mahalla_id?: string | null;

  @IsOptional()
  @IsString()
  occupation_category_id?: string | null;

  @IsOptional()
  @IsString()
  occupation_id?: string | null;
}
