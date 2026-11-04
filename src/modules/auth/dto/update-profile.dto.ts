import { IsOptional, IsString, Length, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString({ message: "Username satr bo'lishi kerak" })
  @Length(3, 50, {
    message: "Username uzunligi 3 dan 50 gacha bo'lishi kerak",
  })
  username?: string;

  @IsOptional()
  @IsString({ message: "Ism satr bo'lishi kerak" })
  first_name?: string;

  @IsOptional()
  @IsString({ message: "Familiya satr bo'lishi kerak" })
  last_name?: string;

  @IsOptional()
  @IsString({ message: "Telefon raqami satr bo'lishi kerak" })
  phone_number?: string;

  @IsOptional()
  @IsString({ message: "Yangi parol satr bo'lishi kerak" })
  @MinLength(4, {
    message: "Parol kamida 4 ta belgidan iborat bo'lishi kerak",
  })
  password?: string;

  @IsOptional()
  @IsString({ message: "Yangi parol satr bo'lishi kerak" })
  @MinLength(4, {
    message: "Yangi parol kamida 4 ta belgidan iborat bo'lishi kerak",
  })
  new_password?: string;

  @IsOptional()
  @IsString({ message: "Hozirgi parol satr bo'lishi kerak" })
  current_password?: string;
}
