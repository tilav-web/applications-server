import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDetectedCrimeIdToApplicationDocuments1764500000000 implements MigrationInterface {
  name = 'AddDetectedCrimeIdToApplicationDocuments1764500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "application_documents"
      ALTER COLUMN "application_id" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "application_documents"
      ADD COLUMN IF NOT EXISTS "detected_crime_id" uuid NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_application_documents_detected_crime'
        ) THEN
          ALTER TABLE "application_documents"
          ADD CONSTRAINT "FK_application_documents_detected_crime"
          FOREIGN KEY ("detected_crime_id") REFERENCES "detected_crimes"("id") ON DELETE CASCADE;
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_application_documents_detected_crime_id"
      ON "application_documents" ("detected_crime_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_application_documents_detected_crime_id"`);
    await queryRunner.query(`
      ALTER TABLE "application_documents"
      DROP CONSTRAINT IF EXISTS "FK_application_documents_detected_crime"
    `);
    await queryRunner.query(`
      ALTER TABLE "application_documents"
      DROP COLUMN IF EXISTS "detected_crime_id"
    `);
  }
}
