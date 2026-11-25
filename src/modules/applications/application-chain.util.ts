import { BadRequestException } from '@nestjs/common';

import { ApplicationRepeatType } from '../../common/enums/appeal-classification.enum';

export interface ChainNodeRef {
  id: string;
  parent_application_id?: string | null;
  root_application_id?: string | null;
  repeat_sequence?: number | null;
}

/**
 * Zanjirning eng birinchi (ildiz) arizasi ID sini aniqlaydi.
 * Agar ota ariza ham takroriy bo'lsa, uning root_application_id si olinadi.
 */
export function resolveRootApplicationId(parent: ChainNodeRef): string {
  return parent.root_application_id || parent.id;
}

/**
 * Zanjirdagi keyingi tartib raqamini (repeat_sequence) hisoblaydi (2, 3, 4, ...).
 */
export function computeNextRepeatSequence(maxExistingSequence: number): number {
  return Math.max(1, Number(maxExistingSequence) || 1) + 1;
}

/**
 * O'z-o'ziga yoki o'z avlodiga bog'lanish (sikl) xatosining oldini oladi.
 */
export function assertNoChainCycle(
  currentApplicationId: string | undefined,
  parentId: string,
  ancestorIds: ReadonlySet<string>,
): void {
  if (!currentApplicationId) return;
  if (currentApplicationId === parentId) {
    throw new BadRequestException("Ariza o'ziga takroriy sifatida bog'lanishi mumkin emas");
  }
  if (ancestorIds.has(currentApplicationId)) {
    throw new BadRequestException(
      'Sikl aniqlandi: ushbu ariza tanlangan arizaning ota/ildiz arizasi hisoblanadi',
    );
  }
}

/**
 * Zarar summasi (totalAmount) hisobida Dublikat arizalarni ikki marta sanashdan himoya qiladi.
 * PRIMARY va SUPPLEMENTAL (va yangi o'tkazma kiritilgan REPEAT) qo'shiladi,
 * DUPLICATE (ko'chirma nusxa) esa zarar summasiga qo'shilmaydi.
 */
export function shouldIncludeInDamageTotal(
  repeatType?: ApplicationRepeatType | string | null,
): boolean {
  return (
    String(repeatType || ApplicationRepeatType.PRIMARY).toUpperCase() !==
    String(ApplicationRepeatType.DUPLICATE)
  );
}
