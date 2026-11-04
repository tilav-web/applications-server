import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: "Username satr bo'lishi kerak" })
  @IsNotEmpty({ message: 'Username kiritilishi shart' })
  username: string;

  @IsString({ message: "Parol satr bo'lishi kerak" })
  @IsNotEmpty({ message: 'Parol kiritilishi shart' })
  @MinLength(4, { message: "Parol kamida 4 ta belgidan iborat bo'lishi kerak" })
  password: string;
}
