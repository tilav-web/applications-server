import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProceduralSlaStatusesAndHistory1764200000000 implements MigrationInterface {
  name = 'AddProceduralSlaStatusesAndHistory1764200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. application_statuses jadvaliga dinamik JPK / SLA atributlarini qo'shish
    await queryRunner.query(`
      ALTER TABLE "application_statuses"
        ADD COLUMN IF NOT EXISTS "category" varchar(30) NOT NULL DEFAULT 'OPEN',
        ADD COLUMN IF NOT EXISTS "tracks_sla" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "default_sla_days" integer NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS "legal_article" varchar(150) NULL,
        ADD COLUMN IF NOT EXISTS "requires_decision" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "requires_rejection_reason" boolean NOT NULL DEFAULT false
    `);

    // 2. applications jadvaliga protsessual muddatlar va qaror rekvizitlarini qo'shish
    await queryRunner.query(`
      ALTER TABLE "applications"
        ADD COLUMN IF NOT EXISTS "deadline_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "sla_days" integer NULL,
        ADD COLUMN IF NOT EXISTS "extended_until" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "extension_reason" text NULL,
        ADD COLUMN IF NOT EXISTS "prosecutor_approval_number" varchar(120) NULL,
        ADD COLUMN IF NOT EXISTS "prosecutor_approval_date" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "decision_number" varchar(120) NULL,
        ADD COLUMN IF NOT EXISTS "decision_date" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "decision_note" text NULL,
        ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP WITH TIME ZONE NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_applications_deadline_at"
        ON "applications" ("deadline_at")
    `);

    // 3. application_status_history (Timeline) jadvalini yaratish
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "application_status_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "application_id" uuid NOT NULL,
        "action" varchar(40) NOT NULL DEFAULT 'STATUS_CHANGED',
        "from_status_id" uuid NULL,
        "from_status_name" varchar(120) NULL,
        "to_status_id" uuid NULL,
        "to_status_name" varchar(120) NULL,
        "old_deadline_at" TIMESTAMP WITH TIME ZONE NULL,
        "new_deadline_at" TIMESTAMP WITH TIME ZONE NULL,
        "prosecutor_approval_number" varchar(120) NULL,
        "prosecutor_approval_date" TIMESTAMP WITH TIME ZONE NULL,
        "decision_type_name" varchar(255) NULL,
        "decision_number" varchar(120) NULL,
        "decision_date" TIMESTAMP WITH TIME ZONE NULL,
        "note" text NULL,
        "changed_by_id" uuid NULL,
        CONSTRAINT "PK_application_status_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_app_status_history_app" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_app_status_history_from" FOREIGN KEY ("from_status_id") REFERENCES "application_statuses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_app_status_history_to" FOREIGN KEY ("to_status_id") REFERENCES "application_statuses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_app_status_history_user" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_app_status_history_app_created"
        ON "application_status_history" ("application_id", "created_at" DESC)
    `);

    // 4. Mavjud statuslarga boshlang'ich kategoriyalarni belgilash
    await queryRunner.query(`
      UPDATE "application_statuses"
      SET "category" = 'CLOSED', "tracks_sla" = false, "default_sla_days" = NULL, "requires_decision" = true
      WHERE UPPER(COALESCE("code", '')) IN ('HAL_QILINDI', 'SUDGA_YUBORILDI', 'YARASHUV', 'MAMURIY', 'TEGISHLILIGI_BOYICHA')
    `);

    await queryRunner.query(`
      UPDATE "application_statuses"
      SET "category" = 'CLOSED', "tracks_sla" = false, "default_sla_days" = NULL, "requires_decision" = true, "requires_rejection_reason" = true
      WHERE UPPER(COALESCE("code", '')) IN ('RAD_ETILDI')
    `);

    await queryRunner.query(`
      UPDATE "application_statuses"
      SET "category" = 'IN_PROGRESS', "tracks_sla" = true, "default_sla_days" = 10
      WHERE UPPER(COALESCE("code", '')) IN ('JARAYONDA', 'TERGOVGA_QADAR')
    `);

    // 5. Mavjud ochiq arizalarga deadline_at ni avtomatik to'ldirish (date + 10 kun)
    await queryRunner.query(`
      UPDATE "applications" a
      SET
        "sla_days" = 10,
        "deadline_at" = COALESCE(a."date", a."created_at") + INTERVAL '10 days'
      WHERE a."deadline_at" IS NULL
        AND a."is_deleted" = false
    `);

    // 6. BullMQ SLA eskalatsiya sozlamalari (Super Admin dinamik boshqaradi)
    await queryRunner.query(`
      INSERT INTO "system_settings" ("key", "value", "description")
      VALUES
        ('sla_warn_hours_before', '72', 'Muddat tugashidan necha soat oldin 1-ogohlantirish yuborilsin (masalan 72 soat = 3 kun)'),
        ('sla_urgent_hours_before', '24', 'Muddat tugashidan necha soat oldin shoshilinch ogohlantirish yuborilsin (masalan 24 soat = 1 kun)'),
        ('sla_escalate_hours_after', '24', 'Muddat o''tgandan necha soat keyin BOSS va SUPER_ADMIN ga eskalatsiya yuborilsin'),
        ('sla_max_extension_days', '30', 'JPK 329-modda bo''yicha maksimal uzaytirish muddati (kun)')
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_app_status_history_app_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "application_status_history"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_applications_deadline_at"`);
    await queryRunner.query(`
      ALTER TABLE "applications"
        DROP COLUMN IF EXISTS "closed_at",
        DROP COLUMN IF EXISTS "decision_note",
        DROP COLUMN IF EXISTS "decision_date",
        DROP COLUMN IF EXISTS "decision_number",
        DROP COLUMN IF EXISTS "prosecutor_approval_date",
        DROP COLUMN IF EXISTS "prosecutor_approval_number",
        DROP COLUMN IF EXISTS "extension_reason",
        DROP COLUMN IF EXISTS "extended_until",
        DROP COLUMN IF EXISTS "sla_days",
        DROP COLUMN IF EXISTS "deadline_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "application_statuses"
        DROP COLUMN IF EXISTS "requires_rejection_reason",
        DROP COLUMN IF EXISTS "requires_decision",
        DROP COLUMN IF EXISTS "legal_article",
        DROP COLUMN IF EXISTS "default_sla_days",
        DROP COLUMN IF EXISTS "tracks_sla",
        DROP COLUMN IF EXISTS "category"
    `);
  }
}
