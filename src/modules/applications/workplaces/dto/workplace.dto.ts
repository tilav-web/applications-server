import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateWorkplaceDto {
  @IsString()
  @IsNotEmpty({ message: 'Ish joyi / tashkilot nomi kiritilishi shart' })
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsUUID()
  district_id?: string | null;

  @IsOptional()
  @IsUUID()
  neighborhood_id?: string | null;

  @IsOptional()
  @IsUUID()
  occupation_category_id?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  occupation_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateWorkplaceDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUUID()
  district_id?: string | null;

  @IsOptional()
  @IsUUID()
  neighborhood_id?: string | null;

  @IsOptional()
  @IsUUID()
  occupation_category_id?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  occupation_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
