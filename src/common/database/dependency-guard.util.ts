import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export interface DependencyCheck {
  table: string;
  column: string;
  label: string;
  extraWhere?: string;
}

/**
 * Master ob'ektlarni o'chirishdan oldin ular bilan bog'liq faol yozuvlar yo'qligini tekshiradi.
 * Agar bog'langan yozuvlar topilsa, 409 ConflictException bilan aniq hisobot qaytaradi.
 */
export async function assertNoDependencies(
  manager: EntityManager,
  entityTitle: string,
  entityId: string,
  checks: DependencyCheck[],
): Promise<void> {
  const blocked: string[] = [];

  for (const check of checks) {
    const whereClause = check.extraWhere
      ? `"${check.column}" = $1 AND (${check.extraWhere})`
      : `"${check.column}" = $1`;

    const rows = await manager.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*)::int AS cnt FROM "${check.table}" WHERE ${whereClause}`,
      [entityId],
    );

    const count = Number(rows?.[0]?.cnt || 0);
    if (count > 0) {
      blocked.push(`${count} ta ${check.label}`);
    }
  }

  if (blocked.length > 0) {
    throw new ConflictException(
      `${entityTitle} o'chirib bo'lmaydi: unga ${blocked.join(', ')} bog'langan. Avval bog'langan yozuvlarni o'zgartiring yoki o'chiring.`,
    );
  }
}
