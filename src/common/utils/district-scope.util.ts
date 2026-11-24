import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { User } from '../../modules/users/user.entity';
import { Role } from '../enums/role.enum';
import type { JwtAccessPayload } from '../types/jwt-payload.interface';

/**
 * DISTRICT_OFFICER uchun biriktirilgan tuman ID larini qaytaradi.
 * Boshqa rollar (SUPER_ADMIN, ADMIN, BOSS, STAFF va b.) uchun `null` qaytaradi (cheklovsiz).
 */
export async function getAllowedDistrictIds(
  userRepo: Repository<User>,
  currentUser?: JwtAccessPayload | null,
): Promise<string[] | null> {
  if (!currentUser || currentUser.role !== Role.DISTRICT_OFFICER) {
    return null;
  }

  const user = await userRepo.findOne({
    where: { auth_id: currentUser.sub },
    relations: { assigned_districts: true },
  });

  return user?.assigned_districts?.map((d) => d.id) ?? [];
}

/**
 * Fail-closed tuman tekshiruvi: DISTRICT_OFFICER uchun targetDistrictId bo'sh (null) bo'lsa ham
 * yoki ruxsat etilgan ro'yxatda bo'lmasa ForbiddenException tashlaydi.
 */
export function assertDistrictAccess(
  allowedDistrictIds: string[] | null,
  targetDistrictId: string | null | undefined,
  message = "Siz faqat o'zingizga biriktirilgan tuman(lar) ma'lumotlariga kira olasiz",
): void {
  if (allowedDistrictIds === null) {
    return;
  }

  if (!targetDistrictId || !allowedDistrictIds.includes(targetDistrictId)) {
    throw new ForbiddenException(message);
  }
}

/**
 * Tashqi bildirishnomalar (Telegram va b.) uchun 16 talik karta raqamini niqoblash.
 */
export function maskCardNumberForAlert(rawCard: string | null | undefined): string {
  if (!rawCard) return 'Karta';
  const digits = rawCard.replace(/\D/g, '');
  if (digits.length === 16) {
    return `${digits.slice(0, 4)} **** **** ${digits.slice(12, 16)}`;
  }
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)} **** ${digits.slice(-4)}`;
  }
  return rawCard;
}
