import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { SuspectTreeNode } from '../../applications/application.entity';
import {
  type DetectedCrimeMeasure,
  DetectedCrimeQualification,
} from '../entities/detected-crime.entity';
import type { EvidenceType } from '../entities/detected-crime-evidence.entity';
import type { DetentionStatus, SuspectCrimeRole } from '../entities/detected-crime-suspect.entity';

export class DetectedCrimeSuspectItemDto {
  @IsUUID()
  citizen_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  role_in_crime?: SuspectCrimeRole;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  detention_status?: DetentionStatus;

  @IsOptional()
  @IsBoolean()
  is_repeat_offender?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class DetectedCrimeEvidenceItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  evidence_type?: EvidenceType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  identifier_value?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  seized_at?: string | null;

  @IsOptional()
  @IsUUID()
  seized_from_citizen_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  file_key?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class SaveDetectedCrimeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  case_number?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'Aniqlangan jinoyat sarlavhasi kiritilishi shart' })
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  report_number?: string | null;

  @IsOptional()
  @IsString()
  report_date?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  kusp_number?: string | null;

  @IsOptional()
  @IsString()
  detected_at?: string | null;

  @IsOptional()
  @IsEnum(DetectedCrimeQualification)
  qualification_type?: DetectedCrimeQualification;

  @IsOptional()
  @IsUUID()
  crime_id?: string | null;

  @IsOptional()
  @IsUUID()
  crime_method_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  mjtk_article?: string | null;

  @IsOptional()
  @IsUUID()
  detection_source_id?: string | null;

  @IsOptional()
  @IsUUID()
  district_id?: string | null;

  @IsOptional()
  @IsUUID()
  department_service_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  platform?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  channel_or_source_url?: string | null;

  @IsOptional()
  @IsArray()
  suspect_tree?: SuspectTreeNode[] | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimated_damage?: number | null;

  @IsOptional()
  @IsString()
  officer_notes?: string | null;

  @IsOptional()
  @IsUUID()
  crime_status_id?: string | null;

  @IsOptional()
  @IsUUID()
  status_id?: string | null;

  @IsOptional()
  @IsArray()
  measures?: DetectedCrimeMeasure[] | null;

  @IsOptional()
  @IsUUID()
  decision_type_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  decision_number?: string | null;

  @IsOptional()
  @IsString()
  decision_date?: string | null;

  @IsOptional()
  @IsString()
  decision_note?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedCrimeSuspectItemDto)
  suspects?: DetectedCrimeSuspectItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedCrimeEvidenceItemDto)
  evidences?: DetectedCrimeEvidenceItemDto[];
}

export class UpdateDetectedCrimeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  case_number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  report_number?: string | null;

  @IsOptional()
  @IsString()
  report_date?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  kusp_number?: string | null;

  @IsOptional()
  @IsString()
  detected_at?: string | null;

  @IsOptional()
  @IsEnum(DetectedCrimeQualification)
  qualification_type?: DetectedCrimeQualification;

  @IsOptional()
  @IsUUID()
  crime_id?: string | null;

  @IsOptional()
  @IsUUID()
  crime_method_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  mjtk_article?: string | null;

  @IsOptional()
  @IsUUID()
  detection_source_id?: string | null;

  @IsOptional()
  @IsUUID()
  district_id?: string | null;

  @IsOptional()
  @IsUUID()
  department_service_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  platform?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  channel_or_source_url?: string | null;

  @IsOptional()
  @IsArray()
  suspect_tree?: SuspectTreeNode[] | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimated_damage?: number | null;

  @IsOptional()
  @IsString()
  officer_notes?: string | null;

  @IsOptional()
  @IsUUID()
  crime_status_id?: string | null;

  @IsOptional()
  @IsUUID()
  status_id?: string | null;

  @IsOptional()
  @IsArray()
  measures?: DetectedCrimeMeasure[] | null;

  @IsOptional()
  @IsUUID()
  decision_type_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  decision_number?: string | null;

  @IsOptional()
  @IsString()
  decision_date?: string | null;

  @IsOptional()
  @IsString()
  decision_note?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedCrimeSuspectItemDto)
  suspects?: DetectedCrimeSuspectItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedCrimeEvidenceItemDto)
  evidences?: DetectedCrimeEvidenceItemDto[];
}

export class ExtendDetectedCrimeDeadlineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  extend_days?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  prosecutor_approval_number?: string;
}

export class CreateDetectedCrimeStatusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_final?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateDetectedCrimeStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_final?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateDetectionSourceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateDetectionSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
