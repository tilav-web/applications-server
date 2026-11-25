import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAwarenessStatuses1765200000000 implements MigrationInterface {
  name = 'AddAwarenessStatuses1765200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "awareness_statuses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(255) NOT NULL,
        "code" character varying(60),
        "is_informed" boolean NOT NULL DEFAULT true,
        "source_channel" character varying(80),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_awareness_statuses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_awareness_statuses_name" UNIQUE ("name"),
        CONSTRAINT "UQ_awareness_statuses_code" UNIQUE ("code")
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "applications"
      ADD COLUMN IF NOT EXISTS "awareness_status_id" uuid NULL,
      ADD COLUMN IF NOT EXISTS "awareness_note" character varying(300) NULL;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_applications_awareness_status'
        ) THEN
          ALTER TABLE "applications"
          ADD CONSTRAINT "FK_applications_awareness_status"
          FOREIGN KEY ("awareness_status_id") REFERENCES "awareness_statuses"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_applications_awareness_status_id"
      ON "applications" ("awareness_status_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_applications_awareness_status_id";
      ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "FK_applications_awareness_status";
      ALTER TABLE "applications"
        DROP COLUMN IF EXISTS "awareness_note",
        DROP COLUMN IF EXISTS "awareness_status_id";
      DROP TABLE IF EXISTS "awareness_statuses";
    `);
  }
}
