import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrimeMethodRelationsAndFields1763800000000 implements MigrationInterface {
  name = 'AddCrimeMethodRelationsAndFields1763800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crime_method_crimes" (
        "crime_method_id" uuid NOT NULL REFERENCES "crime_methods"("id") ON DELETE CASCADE,
        "crime_id" uuid NOT NULL REFERENCES "crimes"("id") ON DELETE CASCADE,
        PRIMARY KEY ("crime_method_id", "crime_id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crime_method_crimes_method_id" ON "crime_method_crimes" ("crime_method_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crime_method_crimes_crime_id" ON "crime_method_crimes" ("crime_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crime_method_fields" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "crime_method_id" uuid NOT NULL REFERENCES "crime_methods"("id") ON DELETE CASCADE,
        "key" varchar(100) NOT NULL,
        "label" varchar(150) NOT NULL,
        "field_type" varchar(30) NOT NULL DEFAULT 'STRING',
        "options" jsonb,
        "placeholder" varchar(255),
        "is_required" boolean NOT NULL DEFAULT false,
        "show_in_excel" boolean NOT NULL DEFAULT true,
        "excel_header" varchar(150),
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crime_method_fields_method_id" ON "crime_method_fields" ("crime_method_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crime_method_fields_method_key" ON "crime_method_fields" ("crime_method_id", "key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crime_method_fields"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crime_method_crimes"`);
  }
}
