import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSuspectFieldLinkableAndCustomFieldRole1765700000000 implements MigrationInterface {
  name = 'AddSuspectFieldLinkableAndCustomFieldRole1765700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "suspect_field_configs"
      ADD COLUMN IF NOT EXISTS "is_linkable" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      UPDATE "suspect_field_configs"
      SET "is_linkable" = false
      WHERE "key" IN ('telegram_bio', 'other_info')
    `);

    await queryRunner.query(`
      ALTER TABLE "application_custom_fields"
      ADD COLUMN IF NOT EXISTS "entity_role" character varying(30)
    `);

    await queryRunner.query(`
      ALTER TABLE "application_damages"
      ADD COLUMN IF NOT EXISTS "recipient_info" character varying(255)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_entity_links_role"
      ON "entity_application_links" ("role")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_entity_links_role"`);
    await queryRunner.query(
      `ALTER TABLE "application_damages" DROP COLUMN IF EXISTS "recipient_info"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_custom_fields" DROP COLUMN IF EXISTS "entity_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "suspect_field_configs" DROP COLUMN IF EXISTS "is_linkable"`,
    );
  }
}
