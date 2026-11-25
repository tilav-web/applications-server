import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalSystemsTables1765400000000 implements MigrationInterface {
  name = 'CreateExternalSystemsTables1765400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "external_systems" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(150) NOT NULL,
        "code" character varying(60),
        "description" character varying(255),
        "color" character varying(30) DEFAULT '#2563EB',
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_external_systems" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_external_systems_name" UNIQUE ("name"),
        CONSTRAINT "UQ_external_systems_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "application_external_systems" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "application_id" uuid NOT NULL,
        "external_system_id" uuid NOT NULL,
        "external_number" character varying(120),
        "entered_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
        "entered_by_id" uuid,
        "note" text,
        CONSTRAINT "PK_application_external_systems" PRIMARY KEY ("id"),
        CONSTRAINT "uq_application_external_system" UNIQUE ("application_id", "external_system_id"),
        CONSTRAINT "FK_app_ext_sys_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_app_ext_sys_system" FOREIGN KEY ("external_system_id") REFERENCES "external_systems"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_app_ext_sys_user" FOREIGN KEY ("entered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_app_ext_sys_app_id"
      ON "application_external_systems" ("application_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_app_ext_sys_sys_app"
      ON "application_external_systems" ("external_system_id", "application_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_app_ext_sys_sys_app"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_app_ext_sys_app_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "application_external_systems"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "external_systems"`);
  }
}
