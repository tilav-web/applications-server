import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransferChannelsTable1764000000000 implements MigrationInterface {
  name = 'CreateTransferChannelsTable1764000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "transfer_channels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" varchar(120) NOT NULL,
        "code" varchar(60) NOT NULL,
        "category" varchar(30) NOT NULL DEFAULT 'PLATFORM',
        "color" varchar(30) NOT NULL DEFAULT '#0891b2',
        "icon" varchar(30) NOT NULL DEFAULT '🌐',
        "presets" jsonb NOT NULL DEFAULT '[]',
        "platform_label" varchar(150) NULL,
        "platform_placeholder" varchar(200) NULL,
        "value_label" varchar(150) NULL,
        "value_placeholder" varchar(200) NULL,
        "sort_order" integer NOT NULL DEFAULT 10,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_transfer_channels" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_transfer_channels_code" UNIQUE ("code")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "transfer_channels"`);
  }
}
