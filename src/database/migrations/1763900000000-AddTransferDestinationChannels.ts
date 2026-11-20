import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransferDestinationChannels1763900000000 implements MigrationInterface {
  name = 'AddTransferDestinationChannels1763900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transfers"
        ADD COLUMN IF NOT EXISTS "destination_type" varchar(30) NOT NULL DEFAULT 'CARD',
        ADD COLUMN IF NOT EXISTS "receiver_identifier_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "destination_label" varchar(255) NULL,
        ADD COLUMN IF NOT EXISTS "destination_details" jsonb NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_transfers_receiver_identifier_id'
        ) THEN
          ALTER TABLE "transfers"
            ADD CONSTRAINT "FK_transfers_receiver_identifier_id"
            FOREIGN KEY ("receiver_identifier_id")
            REFERENCES "digital_identifiers"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_transfers_destination_type"
        ON "transfers" ("destination_type")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_transfers_receiver_identifier_id"
        ON "transfers" ("receiver_identifier_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_receiver_identifier_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transfers_destination_type"`);
    await queryRunner.query(`
      ALTER TABLE "transfers"
        DROP CONSTRAINT IF EXISTS "FK_transfers_receiver_identifier_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "transfers"
        DROP COLUMN IF EXISTS "destination_details",
        DROP COLUMN IF EXISTS "destination_label",
        DROP COLUMN IF EXISTS "receiver_identifier_id",
        DROP COLUMN IF EXISTS "destination_type"
    `);
  }
}
