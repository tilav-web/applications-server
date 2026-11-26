import { MigrationInterface, QueryRunner } from 'typeorm';

export class MergeCitizenNameIntoFullName1765500000000 implements MigrationInterface {
  name = 'MergeCitizenNameIntoFullName1765500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Yangi yagona full_name ustunini qo'shish
    await queryRunner.query(`
      ALTER TABLE "citizens"
      ADD COLUMN IF NOT EXISTS "full_name" character varying(255)
    `);

    // 2. Mavjud last_name, first_name, middle_name ustunlari bor bo'lsa,
    //    barcha fuqarolarning F.I.SH. ma'lumotini "Familiya Ism Otasining ismi" ko'rinishida ko'chirish
    const cols = (await queryRunner.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'citizens'
        AND column_name IN ('first_name', 'last_name', 'middle_name')
    `)) as Array<{ column_name: string }>;
    const existingCols = new Set(cols.map((c) => c.column_name));

    const nameParts: string[] = [];
    if (existingCols.has('last_name')) nameParts.push(`NULLIF(TRIM("last_name"), '')`);
    if (existingCols.has('first_name')) nameParts.push(`NULLIF(TRIM("first_name"), '')`);
    if (existingCols.has('middle_name')) nameParts.push(`NULLIF(TRIM("middle_name"), '')`);

    if (nameParts.length > 0) {
      await queryRunner.query(`
        UPDATE "citizens"
        SET "full_name" = NULLIF(
          TRIM(
            REGEXP_REPLACE(
              CONCAT_WS(' ', ${nameParts.join(', ')}),
              '\\s+',
              ' ',
              'g'
            )
          ),
          ''
        )
        WHERE "full_name" IS NULL OR TRIM("full_name") = ''
      `);
    }

    // 3. Qidiruv tezkorligi uchun indeks yaratish
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_citizens_full_name"
      ON "citizens" ("full_name")
    `);

    // 4. Eski 3 ta ustunni bazadan o'chirish
    await queryRunner.query(`ALTER TABLE "citizens" DROP COLUMN IF EXISTS "first_name"`);
    await queryRunner.query(`ALTER TABLE "citizens" DROP COLUMN IF EXISTS "last_name"`);
    await queryRunner.query(`ALTER TABLE "citizens" DROP COLUMN IF EXISTS "middle_name"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "citizens" ADD COLUMN IF NOT EXISTS "first_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "citizens" ADD COLUMN IF NOT EXISTS "last_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "citizens" ADD COLUMN IF NOT EXISTS "middle_name" character varying(100)`,
    );

    await queryRunner.query(`
      UPDATE "citizens"
      SET
        "last_name" = NULLIF(split_part(TRIM("full_name"), ' ', 1), ''),
        "first_name" = NULLIF(split_part(TRIM("full_name"), ' ', 2), ''),
        "middle_name" = NULLIF(
          TRIM(
            SUBSTRING(
              TRIM("full_name")
              FROM LENGTH(split_part(TRIM("full_name"), ' ', 1))
                 + CASE WHEN split_part(TRIM("full_name"), ' ', 2) <> ''
                        THEN LENGTH(split_part(TRIM("full_name"), ' ', 2)) + 2
                        ELSE 1 END
            )
          ),
          ''
        )
      WHERE "full_name" IS NOT NULL AND TRIM("full_name") <> ''
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_citizens_full_name"`);
    await queryRunner.query(`ALTER TABLE "citizens" DROP COLUMN IF EXISTS "full_name"`);
  }
}
