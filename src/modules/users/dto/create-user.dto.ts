import { IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

import { Role } from '../../../common/enums/role.enum';

export class CreateUserDto {
  @IsNotEmpty({ message: 'Login (username) majburiy' })
  @IsString()
  username: string;

  @IsNotEmpty({ message: 'Parol majburiy' })
  @IsString()
  @MinLength(6, { message: "Parol kamida 6 ta belgidan iborat bo'lishi kerak" })
  password: string;

  @IsOptional()
  @IsEnum(Role, { message: "Noto'g'ri foydalanuvchi roli" })
  role?: Role;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  phone_number?: string;
}
