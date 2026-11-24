import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import type { EntityLinkRole } from '../entities/entity-application-link.entity';

export class AddPhoneToCitizenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(35)
  phone_number: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}

export class AddCardToCitizenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(25)
  card_number: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  expire_date?: string;

  @IsOptional()
  @IsUUID()
  bank_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  bank_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;
}

export class AddIdentifierToCitizenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  type_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class BindEntityToCitizenDto {
  @IsIn(['card', 'phone', 'identifier'])
  entity_type: 'card' | 'phone' | 'identifier';

  @IsUUID()
  entity_id: string;

  @IsUUID()
  citizen_id: string;
}

export class CreateTransitTransferDto {
  @IsOptional()
  @IsUUID()
  sender_card_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  sender_card_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sender_owner_name?: string;

  @IsOptional()
  @IsUUID()
  receiver_card_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  receiver_card_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  receiver_owner_name?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  transfer_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  transfer_time?: string;

  @IsOptional()
  @IsUUID()
  payment_provider_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payment_provider_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transaction_id?: string;

  @IsOptional()
  @IsUUID()
  application_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  destination_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  destination_platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  destination_value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  destination_label?: string;

  @IsOptional()
  @IsObject()
  destination_details?: Record<string, unknown>;
}

export class LinkCitizenRoleDto {
  @IsUUID()
  application_id: string;

  @IsUUID()
  citizen_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  role: EntityLinkRole;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class ConfirmProbableMatchDto {
  @IsUUID()
  citizen_id: string;

  @IsUUID()
  card_id: string;
}
