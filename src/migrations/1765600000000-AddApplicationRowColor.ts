import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplicationRowColor1765600000000 implements MigrationInterface {
  name = 'AddApplicationRowColor1765600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "applications"
      ADD COLUMN IF NOT EXISTS "row_color" character varying(20)
    `);
    await queryRunner.query(`
      ALTER TABLE "applications"
      ADD COLUMN IF NOT EXISTS "row_color_by" character varying(120)
    `);
    await queryRunner.query(`
      ALTER TABLE "applications"
      ADD COLUMN IF NOT EXISTS "row_color_updated_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_applications_row_color"
      ON "applications" ("row_color")
      WHERE "row_color" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_row_color"`);
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN IF EXISTS "row_color_updated_at"`,
    );
    await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN IF EXISTS "row_color_by"`);
    await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN IF EXISTS "row_color"`);
  }
}
