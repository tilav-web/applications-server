import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema mustahkamlash migratsiyasi:
 * 1. `citizens.phone_number` (varchar 24) va `citizens.passport` (varchar 20) kengaytirish
 * 2. Case-insensitive (`LOWER(TRIM(...))`) yagona master indekslar (`AGENTS.md` talabi)
 * 3. `applications.application_number` uchun soft-delete ga mos partial unique index
 * 4. `users.telegram_chat_id` uchun 1:1 unique index
 * 5. Yetishmayotgan Foreign Key B-tree indekslari
 */
export class HardenUniqueIndexesAndMissingFkIndexes1764900000000 implements MigrationInterface {
  name = 'HardenUniqueIndexesAndMissingFkIndexes1764900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Fuqaro telefon va pasport ustunlarini xalqaro formatlar uchun kengaytirish
    await queryRunner.query(`ALTER TABLE "citizens" ALTER COLUMN "phone_number" TYPE varchar(24)`);
    await queryRunner.query(`ALTER TABLE "citizens" ALTER COLUMN "passport" TYPE varchar(20)`);

    // 2. Soft-deleted arizalar raqamini qayta ishlatishga ruxsat beruvchi partial unique index
    await queryRunner.query(`
      DO $$
      DECLARE
        constraint_rec RECORD;
      BEGIN
        FOR constraint_rec IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'applications'::regclass
            AND contype = 'u'
            AND pg_get_constraintdef(oid) LIKE '%application_number%'
        LOOP
          EXECUTE format('ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
        END LOOP;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_applications_active_number"
      ON "applications" ("application_number")
      WHERE "is_deleted" = false
        AND "application_number" IS NOT NULL
        AND TRIM("application_number") <> ''
    `);

    // 3. Master jadvallar uchun case-insensitive va trimmed unique indekslar
    // (Agar mavjud bazada eski case-dublikatlar bo'lsa migratsiya to'xtab qolmasligi uchun xavfsiz blok)
    const functionalUniqueIndexes: Array<{ name: string; sql: string }> = [
      {
        name: 'UQ_districts_lower_name',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_districts_lower_name" ON "districts" (LOWER(TRIM("name"))) WHERE "name" IS NOT NULL AND TRIM("name") <> ''`,
      },
      {
        name: 'UQ_mahallas_district_lower_name',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mahallas_district_lower_name" ON "mahallas" ("district_id", LOWER(TRIM("name"))) WHERE "name" IS NOT NULL AND TRIM("name") <> ''`,
      },
      {
        name: 'UQ_banks_lower_name',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_banks_lower_name" ON "banks" (LOWER(TRIM("name"))) WHERE "name" IS NOT NULL AND TRIM("name") <> ''`,
      },
      {
        name: 'UQ_crimes_lower_article',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crimes_lower_article" ON "crimes" (LOWER(TRIM("article"))) WHERE "article" IS NOT NULL AND TRIM("article") <> ''`,
      },
      {
        name: 'UQ_payment_providers_lower_name',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_providers_lower_name" ON "payment_providers" (LOWER(TRIM("name"))) WHERE "name" IS NOT NULL AND TRIM("name") <> ''`,
      },
      {
        name: 'UQ_users_telegram_chat_id',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_telegram_chat_id" ON "users" ("telegram_chat_id") WHERE "telegram_chat_id" IS NOT NULL AND TRIM("telegram_chat_id") <> ''`,
      },
    ];

    for (const idx of functionalUniqueIndexes) {
      await queryRunner.query(`
        DO $$ BEGIN
          ${idx.sql};
        EXCEPTION WHEN unique_violation THEN
          RAISE NOTICE 'Index % skipped due to existing legacy duplicates', '${idx.name}';
        END $$;
      `);
    }

    // 4. Yetishmayotgan Foreign Key B-tree indekslari
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_phones_citizen_id" ON "phones" ("citizen_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_digital_identifiers_citizen_id" ON "digital_identifiers" ("citizen_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_crime_status_id" ON "detected_crimes" ("crime_status_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_detection_source_id" ON "detected_crimes" ("detection_source_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_crime_method_id" ON "detected_crimes" ("crime_method_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_workplace_id" ON "applications" ("workplace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_crime_method_id" ON "applications" ("crime_method_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_source_id" ON "applications" ("source_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_department_service_id" ON "applications" ("department_service_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_department_service_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_source_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_crime_method_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_workplace_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_detected_crimes_crime_method_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_detected_crimes_detection_source_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_detected_crimes_crime_status_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_digital_identifiers_citizen_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_phones_citizen_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_telegram_chat_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_payment_providers_lower_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_crimes_lower_article"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_banks_lower_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_mahallas_district_lower_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_districts_lower_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_applications_active_number"`);
  }
}
