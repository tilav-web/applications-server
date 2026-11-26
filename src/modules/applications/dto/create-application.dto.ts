import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import {
  AppealType,
  ApplicantType,
  ApplicationRepeatType,
  SubmissionForm,
} from '../../../common/enums/appeal-classification.enum';
import { CustomFieldType } from '../../../common/enums/custom-field-type.enum';
import { ApplicationDamageType } from '../../../common/enums/damage-type.enum';

export class CreateApplicationDamageDto {
  @IsOptional()
  @IsEnum(ApplicationDamageType)
  damage_type?: ApplicationDamageType;

  @IsOptional()
  @IsString()
  organization_name?: string | null;

  @IsOptional()
  @IsUUID('4')
  bank_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  payment_provider_id?: string | null;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string | null;

  @IsOptional()
  @IsString()
  contract_number?: string | null;

  @IsOptional()
  @IsString()
  damage_date?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  order?: number;
}

export class CreateApplicationCustomFieldDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsEnum(CustomFieldType)
  type?: CustomFieldType;

  @IsOptional()
  value?: unknown;

  // Sub-model Foreign Keys
  @IsOptional()
  @IsUUID('4')
  citizen_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  card_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  crime_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  crime_method_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  district_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  transfer_id?: string | null;

  // Inline yangi yaratish uchun ma'lumotlar
  @IsOptional()
  @IsObject()
  inline_citizen?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_card?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_crime?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_district?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inline_transfer?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  order?: number;
}

export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  application_number?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  officer_notes?: string | null;

  @IsOptional()
  @IsArray()
  suspect_tree?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID('4')
  status_id?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  deadline_at?: string | null;

  @IsOptional()
  @IsNumber()
  sla_days?: number | null;

  @IsOptional()
  @IsString()
  extension_reason?: string | null;

  @IsOptional()
  @IsString()
  prosecutor_approval_number?: string | null;

  @IsOptional()
  @IsDateString()
  prosecutor_approval_date?: string | null;

  @IsOptional()
  @IsString()
  decision_number?: string | null;

  @IsOptional()
  @IsDateString()
  decision_date?: string | null;

  @IsOptional()
  @IsString()
  decision_note?: string | null;

  @IsOptional()
  @IsString()
  status_change_note?: string | null;

  // Murojaat tasnifi va takroriy/dublikat zanjiri (O'RQ-445)
  @IsOptional()
  @IsEnum(AppealType)
  appeal_type?: AppealType;

  @IsOptional()
  @IsEnum(SubmissionForm)
  submission_form?: SubmissionForm;

  @IsOptional()
  @IsEnum(ApplicantType)
  applicant_type?: ApplicantType;

  @IsOptional()
  @IsEnum(ApplicationRepeatType)
  repeat_type?: ApplicationRepeatType;

  @IsOptional()
  @IsUUID('4')
  parent_application_id?: string | null;

  @IsOptional()
  @IsString()
  repeat_reason?: string | null;

  @IsOptional()
  @IsBoolean()
  is_review_terminated?: boolean;

  @IsOptional()
  @IsString()
  termination_note?: string | null;

  // Birlamchi Asosiy Modellar (Har biridan bittadan ManyToOne)
  @IsOptional()
  @IsUUID('4')
  citizen_id?: string | null;

  @IsOptional()
  @IsObject()
  citizen_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  crime_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  crime_method_id?: string | null;

  @IsOptional()
  @IsObject()
  crime_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  district_id?: string | null;

  @IsOptional()
  @IsObject()
  district_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  card_id?: string | null;

  @IsOptional()
  @IsObject()
  card_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  transfer_id?: string | null;

  @IsOptional()
  @IsObject()
  transfer_data?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  source_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  awareness_status_id?: string | null;

  @IsOptional()
  @IsString()
  awareness_note?: string | null;

  @IsOptional()
  @IsUUID('4')
  department_service_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  rejection_reason_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  decision_type_id?: string | null;

  @IsOptional()
  @IsUUID('4')
  workplace_id?: string | null;

  @IsOptional()
  @IsString()
  work_position?: string | null;

  @IsOptional()
  @IsObject()
  workplace_data?: Record<string, unknown>;

  // Yagona massiv: Dinamik Custom Fields
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApplicationCustomFieldDto)
  custom_fields?: CreateApplicationCustomFieldDto[];

  // Kartasiz moddiy zararlar (Kredit, Nasiya, Tovar/Xizmat aldovi va b.)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApplicationDamageDto)
  damages?: CreateApplicationDamageDto[];

  // Ariza kiritilgan tashqi tizimlar ID lari (CardBlock, E-Elektron, E-Material, ...)
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  external_system_ids?: string[];
}
