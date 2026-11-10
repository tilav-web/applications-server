import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateFromTemplateDto {
  @IsNotEmpty({ message: 'Shablon tanlanishi shart' })
  @IsString()
  templateId: string;

  @IsNotEmpty({ message: 'Alifbo (yozuv) tanlanishi shart' })
  @IsIn(['lotin', 'krill'], { message: "Alifbo faqat 'lotin' yoki 'krill' bo'lishi mumkin" })
  script: 'lotin' | 'krill';

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  customData?: Record<string, string>;
}
