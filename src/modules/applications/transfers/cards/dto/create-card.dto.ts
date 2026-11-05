import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCardDto {
  @IsOptional()
  @IsString()
  card_number?: string;

  @IsOptional()
  @IsString()
  masked_number?: string;

  @IsOptional()
  @IsString()
  expire_date?: string;

  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsUUID('4', { message: "citizen_id to'g'ri UUID bo'lishi kerak" })
  citizen_id?: string;

  @IsOptional()
  @IsUUID('4', { message: "bank_id to'g'ri UUID bo'lishi kerak" })
  bank_id?: string;
}
