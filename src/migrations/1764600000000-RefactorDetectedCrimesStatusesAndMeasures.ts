import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorDetectedCrimesStatusesAndMeasures1764600000000 implements MigrationInterface {
  name = 'RefactorDetectedCrimesStatusesAndMeasures1764600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "detected_crime_statuses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(150) NOT NULL,
        "code" character varying(60) NOT NULL,
        "color" character varying(30) NOT NULL DEFAULT 'rose',
        "is_default" boolean NOT NULL DEFAULT false,
        "is_final" boolean NOT NULL DEFAULT false,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_detected_crime_statuses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_detected_crime_statuses_name" UNIQUE ("name"),
        CONSTRAINT "UQ_detected_crime_statuses_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "detected_crimes"
      ADD COLUMN IF NOT EXISTS "crime_status_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "detected_crimes"
      ADD COLUMN IF NOT EXISTS "measures" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_detected_crimes_crime_status'
        ) THEN
          ALTER TABLE "detected_crimes"
          ADD CONSTRAINT "FK_detected_crimes_crime_status"
          FOREIGN KEY ("crime_status_id") REFERENCES "detected_crime_statuses"("id") ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_crime_status_id"
      ON "detected_crimes" ("crime_status_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_detected_crimes_crime_status_id"`);
    await queryRunner.query(`
      ALTER TABLE "detected_crimes" DROP CONSTRAINT IF EXISTS "FK_detected_crimes_crime_status"
    `);
    await queryRunner.query(`ALTER TABLE "detected_crimes" DROP COLUMN IF EXISTS "measures"`);
    await queryRunner.query(
      `ALTER TABLE "detected_crimes" DROP COLUMN IF EXISTS "crime_status_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "detected_crime_statuses"`);
  }
}
