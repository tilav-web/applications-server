import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsRootToAuth1764800000000 implements MigrationInterface {
  name = 'AddIsRootToAuth1764800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth" ADD COLUMN IF NOT EXISTS "is_root" boolean NOT NULL DEFAULT false`,
    );

    // Mavjud birinchi SUPER_ADMIN hisobini Root Super Admin qilib belgilaymiz
    await queryRunner.query(`
      UPDATE "auth"
      SET "is_root" = true
      WHERE "id" = (
        SELECT "id"
        FROM "auth"
        WHERE "role" = 'SUPER_ADMIN'
        ORDER BY "created_at" ASC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM "auth" WHERE "is_root" = true
      )
    `);

    // Bazada ko'pi bilan bitta Root Super Admin bo'lishini kafolatlaymiz
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_auth_single_root" ON "auth" ("is_root") WHERE "is_root" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_auth_single_root"`);
    await queryRunner.query(`ALTER TABLE "auth" DROP COLUMN IF EXISTS "is_root"`);
  }
}
