import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkplacesAndEmploymentFields1764300000000 implements MigrationInterface {
  name = 'CreateWorkplacesAndEmploymentFields1764300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workplaces" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" varchar(255) NOT NULL,
        "district_id" uuid NULL,
        "mahalla_id" uuid NULL,
        "occupation_category_id" uuid NULL,
        "address" varchar(255) NULL,
        "inn" varchar(20) NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_workplaces" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workplaces_district" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_workplaces_mahalla" FOREIGN KEY ("mahalla_id") REFERENCES "mahallas"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_workplaces_occ_cat" FOREIGN KEY ("occupation_category_id") REFERENCES "occupation_categories"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workplaces_district_id" ON "workplaces" ("district_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workplaces_mahalla_id" ON "workplaces" ("mahalla_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workplaces_category_id" ON "workplaces" ("occupation_category_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "citizens"
        ADD COLUMN IF NOT EXISTS "workplace_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "work_position" varchar(200) NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_citizens_workplace_id') THEN
          ALTER TABLE "citizens"
            ADD CONSTRAINT "FK_citizens_workplace_id"
            FOREIGN KEY ("workplace_id") REFERENCES "workplaces"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_citizens_workplace_id" ON "citizens" ("workplace_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "applications"
        ADD COLUMN IF NOT EXISTS "workplace_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "work_position" varchar(200) NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_applications_workplace_id') THEN
          ALTER TABLE "applications"
            ADD CONSTRAINT "FK_applications_workplace_id"
            FOREIGN KEY ("workplace_id") REFERENCES "workplaces"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_applications_workplace_id" ON "applications" ("workplace_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_workplace_id"`);
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "FK_applications_workplace_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "applications"
        DROP COLUMN IF EXISTS "work_position",
        DROP COLUMN IF EXISTS "workplace_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_citizens_workplace_id"`);
    await queryRunner.query(
      `ALTER TABLE "citizens" DROP CONSTRAINT IF EXISTS "FK_citizens_workplace_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "citizens"
        DROP COLUMN IF EXISTS "work_position",
        DROP COLUMN IF EXISTS "workplace_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workplaces_category_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workplaces_mahalla_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workplaces_district_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workplaces"`);
  }
}
