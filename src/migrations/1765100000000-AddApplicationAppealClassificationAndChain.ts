import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplicationAppealClassificationAndChain1765100000000 implements MigrationInterface {
  name = 'AddApplicationAppealClassificationAndChain1765100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "applications"
      ADD COLUMN IF NOT EXISTS "appeal_type" varchar(30) NOT NULL DEFAULT 'APPEAL',
      ADD COLUMN IF NOT EXISTS "submission_form" varchar(30) NOT NULL DEFAULT 'WRITTEN',
      ADD COLUMN IF NOT EXISTS "applicant_type" varchar(30) NOT NULL DEFAULT 'INDIVIDUAL',
      ADD COLUMN IF NOT EXISTS "repeat_type" varchar(30) NOT NULL DEFAULT 'PRIMARY',
      ADD COLUMN IF NOT EXISTS "parent_application_id" uuid NULL,
      ADD COLUMN IF NOT EXISTS "root_application_id" uuid NULL,
      ADD COLUMN IF NOT EXISTS "repeat_sequence" integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "repeat_reason" text NULL,
      ADD COLUMN IF NOT EXISTS "is_review_terminated" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "termination_note" text NULL;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_applications_parent_application'
        ) THEN
          ALTER TABLE "applications"
          ADD CONSTRAINT "FK_applications_parent_application"
          FOREIGN KEY ("parent_application_id") REFERENCES "applications"("id") ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_applications_root_application'
        ) THEN
          ALTER TABLE "applications"
          ADD CONSTRAINT "FK_applications_root_application"
          FOREIGN KEY ("root_application_id") REFERENCES "applications"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_applications_appeal_type" ON "applications" ("appeal_type");
      CREATE INDEX IF NOT EXISTS "IDX_applications_repeat_type" ON "applications" ("repeat_type");
      CREATE INDEX IF NOT EXISTS "IDX_applications_parent_application_id" ON "applications" ("parent_application_id");
      CREATE INDEX IF NOT EXISTS "IDX_applications_root_application_id" ON "applications" ("root_application_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_applications_root_application_id";
      DROP INDEX IF EXISTS "IDX_applications_parent_application_id";
      DROP INDEX IF EXISTS "IDX_applications_repeat_type";
      DROP INDEX IF EXISTS "IDX_applications_appeal_type";
    `);

    await queryRunner.query(`
      ALTER TABLE "applications"
      DROP CONSTRAINT IF EXISTS "FK_applications_root_application",
      DROP CONSTRAINT IF EXISTS "FK_applications_parent_application";
    `);

    await queryRunner.query(`
      ALTER TABLE "applications"
      DROP COLUMN IF EXISTS "termination_note",
      DROP COLUMN IF EXISTS "is_review_terminated",
      DROP COLUMN IF EXISTS "repeat_reason",
      DROP COLUMN IF EXISTS "repeat_sequence",
      DROP COLUMN IF EXISTS "root_application_id",
      DROP COLUMN IF EXISTS "parent_application_id",
      DROP COLUMN IF EXISTS "repeat_type",
      DROP COLUMN IF EXISTS "applicant_type",
      DROP COLUMN IF EXISTS "submission_form",
      DROP COLUMN IF EXISTS "appeal_type";
    `);
  }
}
