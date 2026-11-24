import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1. `regions` (Viloyatlar) master jadvalini yaratish
 * 2. `districts` jadvaliga `region_id`, `latitude`, `longitude` ustunlarini qo'shish
 * 3. `mahallas` jadvalini inglizcha `neighborhoods` nomiga o'tkazish va `latitude`, `longitude` qo'shish
 * 4. `citizens.mahalla_id` va `workplaces.mahalla_id` ustunlarini `neighborhood_id` ga o'tkazish
 * 5. Default "Qashqadaryo viloyati" yozuvini kiritish va mavjud tumanlarni unga bog'lash
 */
export class AddRegionsAndGeoCoordinates1765000000000 implements MigrationInterface {
  name = 'AddRegionsAndGeoCoordinates1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Regions jadvali
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "regions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying(150) NOT NULL,
        "code" character varying(50),
        "latitude" double precision,
        "longitude" double precision,
        CONSTRAINT "PK_regions_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_regions_lower_name"
      ON "regions" (LOWER(TRIM("name")))
      WHERE "name" IS NOT NULL AND TRIM("name") <> ''
    `);

    // 2. Districts jadvaliga region_id, latitude, longitude qo'shish
    await queryRunner.query(`ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "region_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "latitude" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "districts" ADD COLUMN IF NOT EXISTS "longitude" double precision`,
    );

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "districts"
          ADD CONSTRAINT "FK_districts_region_id"
          FOREIGN KEY ("region_id") REFERENCES "regions"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_districts_region_id" ON "districts" ("region_id")`,
    );

    // 3. mahallas -> neighborhoods (mavjud ma'lumotlarni yo'qotmasdan rename)
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'mahallas'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'neighborhoods'
        ) THEN
          ALTER TABLE "mahallas" RENAME TO "neighborhoods";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "neighborhoods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying(150) NOT NULL,
        "district_id" uuid NOT NULL,
        "tracking_id" character varying(100),
        "latitude" double precision,
        "longitude" double precision,
        CONSTRAINT "PK_neighborhoods_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "neighborhoods" ADD COLUMN IF NOT EXISTS "latitude" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "neighborhoods" ADD COLUMN IF NOT EXISTS "longitude" double precision`,
    );

    // Eski indekslarni yangi nomlarga o'tkazish / yaratish
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mahallas_district_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_mahallas_district_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_mahallas_district_lower_name"`);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_neighborhoods_district_id" ON "neighborhoods" ("district_id")`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "UQ_neighborhoods_district_name"
          ON "neighborhoods" ("district_id", "name");
      EXCEPTION WHEN unique_violation THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS "UQ_neighborhoods_district_lower_name"
          ON "neighborhoods" ("district_id", LOWER(TRIM("name")))
          WHERE "name" IS NOT NULL AND TRIM("name") <> '';
      EXCEPTION WHEN unique_violation THEN NULL;
      END $$;
    `);

    // 4. citizens.mahalla_id -> neighborhood_id
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'citizens' AND column_name = 'mahalla_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'citizens' AND column_name = 'neighborhood_id'
        ) THEN
          ALTER TABLE "citizens" RENAME COLUMN "mahalla_id" TO "neighborhood_id";
        END IF;
      END $$;
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_citizens_mahalla_id"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_citizens_neighborhood_id" ON "citizens" ("neighborhood_id")`,
    );

    // 5. workplaces.mahalla_id -> neighborhood_id
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'workplaces' AND column_name = 'mahalla_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'workplaces' AND column_name = 'neighborhood_id'
        ) THEN
          ALTER TABLE "workplaces" RENAME COLUMN "mahalla_id" TO "neighborhood_id";
        END IF;
      END $$;
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workplaces_mahalla_id"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_workplaces_neighborhood_id" ON "workplaces" ("neighborhood_id")`,
    );

    // 6. Default Qashqadaryo viloyatini kiritish va mavjud tumanlarni biriktirish
    await queryRunner.query(`
      INSERT INTO "regions" ("name", "code", "latitude", "longitude")
      SELECT 'Qashqadaryo viloyati', 'QASHQADARYO', 38.7888, 66.0314
      WHERE NOT EXISTS (
        SELECT 1 FROM "regions"
        WHERE LOWER(TRIM("name")) IN ('qashqadaryo viloyati', 'qashqadaryo')
           OR UPPER(TRIM(COALESCE("code", ''))) = 'QASHQADARYO'
      )
    `);

    await queryRunner.query(`
      UPDATE "districts"
      SET "region_id" = (
        SELECT "id" FROM "regions"
        WHERE LOWER(TRIM("name")) IN ('qashqadaryo viloyati', 'qashqadaryo')
           OR UPPER(TRIM(COALESCE("code", ''))) = 'QASHQADARYO'
        ORDER BY "created_at" ASC
        LIMIT 1
      )
      WHERE "region_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workplaces_neighborhood_id"`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'workplaces' AND column_name = 'neighborhood_id'
        ) THEN
          ALTER TABLE "workplaces" RENAME COLUMN "neighborhood_id" TO "mahalla_id";
        END IF;
      END $$;
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_citizens_neighborhood_id"`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'citizens' AND column_name = 'neighborhood_id'
        ) THEN
          ALTER TABLE "citizens" RENAME COLUMN "neighborhood_id" TO "mahalla_id";
        END IF;
      END $$;
    `);

    await queryRunner.query(`ALTER TABLE "neighborhoods" DROP COLUMN IF EXISTS "longitude"`);
    await queryRunner.query(`ALTER TABLE "neighborhoods" DROP COLUMN IF EXISTS "latitude"`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'neighborhoods'
        ) THEN
          ALTER TABLE "neighborhoods" RENAME TO "mahallas";
        END IF;
      END $$;
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_districts_region_id"`);
    await queryRunner.query(
      `ALTER TABLE "districts" DROP CONSTRAINT IF EXISTS "FK_districts_region_id"`,
    );
    await queryRunner.query(`ALTER TABLE "districts" DROP COLUMN IF EXISTS "longitude"`);
    await queryRunner.query(`ALTER TABLE "districts" DROP COLUMN IF EXISTS "latitude"`);
    await queryRunner.query(`ALTER TABLE "districts" DROP COLUMN IF EXISTS "region_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_regions_lower_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "regions"`);
  }
}
