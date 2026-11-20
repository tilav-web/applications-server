import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UpgradeAuditLogsAndSettings1763700000000 implements MigrationInterface {
  name = 'UpgradeAuditLogsAndSettings1763700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "action" varchar(64) NOT NULL DEFAULT 'API_REQUEST'`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "entity_type" varchar(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "entity_id" varchar(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "summary" varchar(512)`,
    );
    await queryRunner.query(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "details" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "is_success" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "severity" varchar(16) NOT NULL DEFAULT 'INFO'`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_entity_type" ON "audit_logs" ("entity_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_severity" ON "audit_logs" ("severity")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "system_settings" (
        "key" varchar(100) PRIMARY KEY,
        "value" varchar(500) NOT NULL,
        "description" varchar(255),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO "system_settings" ("key", "value", "description")
      VALUES
        ('audit_retention_days', '90', 'Audit loglarni avtomatik saqlash muddati (kunlarda, 0 = cheksiz)'),
        ('audit_archive_to_minio', 'true', 'Tozalashdan oldin eski audit loglarni MinIO ga arxivlash')
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "system_settings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_severity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_entity_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action"`);
  }
}
