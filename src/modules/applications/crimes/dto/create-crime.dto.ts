import { IsEnum, IsOptional, IsString } from 'class-validator';

import { CrimeGravity } from '../../../../common/enums/crime-gravity.enum';

export class CreateCrimeDto {
  @IsOptional()
  @IsString()
  article?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(CrimeGravity, {
    message:
      "Og'irlik darajasi faqat quyidagilardan biri bo'lishi mumkin: UNCHA_OGIR_BOLMAGAN, ORTA_OGIR, OGIR, JUDA_OGIR",
  })
  gravity?: CrimeGravity;

  @IsOptional()
  @IsString()
  description?: string;
}
