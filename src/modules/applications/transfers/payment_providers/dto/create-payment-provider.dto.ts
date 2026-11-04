import { IsOptional, IsString } from 'class-validator';

export class CreatePaymentProviderDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;
}
