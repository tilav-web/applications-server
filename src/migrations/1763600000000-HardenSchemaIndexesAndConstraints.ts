import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenSchemaIndexesAndConstraints1763600000000 implements MigrationInterface {
  name = 'HardenSchemaIndexesAndConstraints1763600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Soft-delete audit ustunlari (applications) va aniq timestamp (transfers)
    await queryRunner.query(
      `ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "deleted_by_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "transfer_at" TIMESTAMP WITH TIME ZONE`,
    );

    // 2. Partial Unique Indexes — NULL (noma'lum) qiymatlarga ruxsat beradi, lekin aniq qiymat dublikatini bloklaydi
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_citizens_passport_not_null" ON "citizens" ("passport") WHERE "passport" IS NOT NULL AND "passport" <> ''`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_citizens_pinfl_not_null" ON "citizens" ("pinfl") WHERE "pinfl" IS NOT NULL AND "pinfl" <> ''`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cards_card_number_not_null" ON "cards" ("card_number") WHERE "card_number" IS NOT NULL AND "card_number" <> ''`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_districts_name_not_null" ON "districts" ("name") WHERE "name" IS NOT NULL AND "name" <> ''`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mahallas_district_name" ON "mahallas" ("district_id", "name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_banks_name_not_null" ON "banks" ("name") WHERE "name" IS NOT NULL AND "name" <> ''`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_banks_mfo_not_null" ON "banks" ("mfo") WHERE "mfo" IS NOT NULL AND "mfo" <> ''`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crimes_article_not_null" ON "crimes" ("article") WHERE "article" IS NOT NULL AND "article" <> ''`,
    );

    // 3. B-tree indekslar (Foreign Key va tez-tez filtrlanadigan ustunlar)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_is_deleted_date" ON "applications" ("is_deleted", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_district_id" ON "applications" ("district_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_status_id" ON "applications" ("status_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_citizen_id" ON "applications" ("citizen_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_crime_id" ON "applications" ("crime_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_card_id" ON "applications" ("card_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_transfer_id" ON "applications" ("transfer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_created_by_id" ON "applications" ("created_by_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_citizens_phone_number" ON "citizens" ("phone_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_citizens_district_id" ON "citizens" ("district_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_citizens_mahalla_id" ON "citizens" ("mahalla_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cards_citizen_id" ON "cards" ("citizen_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cards_bank_id" ON "cards" ("bank_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfers_application_id" ON "transfers" ("application_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfers_sender_card_id" ON "transfers" ("sender_card_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfers_receiver_card_id" ON "transfers" ("receiver_card_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfers_card_id" ON "transfers" ("card_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfers_payment_provider_id" ON "transfers" ("payment_provider_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transfers_transfer_at" ON "transfers" ("transfer_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_custom_fields_application_id" ON "application_custom_fields" ("application_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_custom_fields_citizen_id" ON "application_custom_fields" ("citizen_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_custom_fields_card_id" ON "application_custom_fields" ("card_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_custom_fields_transfer_id" ON "application_custom_fields" ("transfer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_app_custom_fields_type" ON "application_custom_fields" ("type")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_mahallas_district_id" ON "mahallas" ("district_id")`,
    );

    // 4. Mavjud transfer_date/transfer_time qiymatlaridan transfer_at ni to'ldirish
    await queryRunner.query(`
      UPDATE "transfers"
      SET "transfer_at" = (
        CASE
          WHEN "transfer_date" ~ '^\\d{4}-\\d{2}-\\d{2}$' AND "transfer_time" ~ '^\\d{2}:\\d{2}(:\\d{2})?$'
            THEN ("transfer_date" || ' ' || "transfer_time")::timestamptz
          WHEN "transfer_date" ~ '^\\d{4}-\\d{2}-\\d{2}$'
            THEN "transfer_date"::timestamptz
          ELSE NULL
        END
      )
      WHERE "transfer_at" IS NULL AND "transfer_date" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mahallas_district_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_custom_fields_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_custom_fields_transfer_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_custom_fields_card_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_custom_fields_citizen_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_custom_fields_application_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_transfer_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_payment_provider_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_card_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_receiver_card_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_sender_card_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_application_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cards_bank_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cards_citizen_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_citizens_mahalla_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_citizens_district_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_citizens_phone_number"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_created_by_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_transfer_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_card_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_crime_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_citizen_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_status_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_district_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_is_deleted_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_crimes_article_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_banks_mfo_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_banks_name_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_mahallas_district_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_districts_name_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_cards_card_number_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_citizens_pinfl_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_citizens_passport_not_null"`);
    await queryRunner.query(`ALTER TABLE "transfers" DROP COLUMN IF EXISTS "transfer_at"`);
    await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN IF EXISTS "deleted_by_id"`);
    await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN IF EXISTS "deleted_at"`);
  }
}
