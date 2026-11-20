import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsAndTelegram1764100000000 implements MigrationInterface {
  name = 'CreateNotificationsAndTelegram1764100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "user_id" uuid NOT NULL,
        "type" varchar(50) NOT NULL DEFAULT 'SYSTEM',
        "priority" varchar(20) NOT NULL DEFAULT 'INFO',
        "title" varchar(255) NOT NULL,
        "message" text NOT NULL,
        "link_url" varchar(300) NULL,
        "metadata" jsonb NULL,
        "is_read" boolean NOT NULL DEFAULT false,
        "read_at" TIMESTAMP WITH TIME ZONE NULL,
        "sent_to_telegram" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_user_read_created"
        ON "notifications" ("user_id", "is_read", "created_at" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "telegram_chat_id" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "telegram_username" varchar(100) NULL,
        ADD COLUMN IF NOT EXISTS "telegram_first_name" varchar(120) NULL,
        ADD COLUMN IF NOT EXISTS "telegram_link_token" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "telegram_link_expires_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_telegram_chat_id"
        ON "users" ("telegram_chat_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_telegram_link_token"
        ON "users" ("telegram_link_token")
        WHERE "telegram_link_token" IS NOT NULL
    `);

    // Default notification & Telegram Bot settings
    await queryRunner.query(`
      INSERT INTO "system_settings" ("key", "value", "description")
      VALUES
        ('telegram_bot_token', '', 'Telegram Bot API token'),
        ('telegram_bot_enabled', 'false', 'Telegram Bot faol holati'),
        ('telegram_bot_id', '', 'Telegram Bot ID (getMe)'),
        ('telegram_bot_username', '', 'Telegram Bot username (getMe)'),
        ('telegram_bot_name', '', 'Telegram Bot nomi (getMe)'),
        ('notif_high_value_threshold', '50000000', 'Yirik zarar ogohlantirish chegarasi (UZS)'),
        ('notif_sla_days', '10', 'Ariza ko''rib chiqish standart muddati (kun)'),
        ('notif_daily_digest_enabled', 'true', 'Kunlik Telegram svodkani yoqish'),
        ('notif_daily_digest_hour', '18', 'Kunlik svodka yuborish soati (0-23)')
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_telegram_link_token"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_telegram_chat_id"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "notification_prefs",
        DROP COLUMN IF EXISTS "telegram_link_expires_at",
        DROP COLUMN IF EXISTS "telegram_link_token",
        DROP COLUMN IF EXISTS "telegram_first_name",
        DROP COLUMN IF EXISTS "telegram_username",
        DROP COLUMN IF EXISTS "telegram_chat_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_user_read_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
