import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApplicationDamagesTable1765300000000 implements MigrationInterface {
  name = 'CreateApplicationDamagesTable1765300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "application_damages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "application_id" uuid NOT NULL,
        "damage_type" character varying(40) NOT NULL DEFAULT 'ONLINE_CREDIT',
        "organization_name" character varying(255),
        "bank_id" uuid,
        "payment_provider_id" uuid,
        "amount" numeric(18,2) NOT NULL,
        "currency" character varying(10) NOT NULL DEFAULT 'UZS',
        "contract_number" character varying(120),
        "damage_date" character varying(20),
        "description" text,
        "order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_application_damages" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_application_damages_application'
        ) THEN
          ALTER TABLE "application_damages"
          ADD CONSTRAINT "FK_application_damages_application"
          FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_application_damages_bank'
        ) THEN
          ALTER TABLE "application_damages"
          ADD CONSTRAINT "FK_application_damages_bank"
          FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_application_damages_provider'
        ) THEN
          ALTER TABLE "application_damages"
          ADD CONSTRAINT "FK_application_damages_provider"
          FOREIGN KEY ("payment_provider_id") REFERENCES "payment_providers"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_application_damages_application_id"
      ON "application_damages" ("application_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_application_damages_damage_type"
      ON "application_damages" ("damage_type");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_application_damages_damage_type";
      DROP INDEX IF EXISTS "IDX_application_damages_application_id";
      ALTER TABLE "application_damages" DROP CONSTRAINT IF EXISTS "FK_application_damages_provider";
      ALTER TABLE "application_damages" DROP CONSTRAINT IF EXISTS "FK_application_damages_bank";
      ALTER TABLE "application_damages" DROP CONSTRAINT IF EXISTS "FK_application_damages_application";
      DROP TABLE IF EXISTS "application_damages";
    `);
  }
}
