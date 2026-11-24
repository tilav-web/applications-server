import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkplaceOccupationsRelation1764700000000 implements MigrationInterface {
  name = 'CreateWorkplaceOccupationsRelation1764700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workplace_occupations" (
        "workplace_id" uuid NOT NULL,
        "occupation_id" uuid NOT NULL,
        CONSTRAINT "PK_workplace_occupations" PRIMARY KEY ("workplace_id", "occupation_id"),
        CONSTRAINT "FK_workplace_occupations_workplace"
          FOREIGN KEY ("workplace_id") REFERENCES "workplaces"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_workplace_occupations_occupation"
          FOREIGN KEY ("occupation_id") REFERENCES "occupations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workplace_occupations_workplace_id"
      ON "workplace_occupations" ("workplace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_workplace_occupations_occupation_id"
      ON "workplace_occupations" ("occupation_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workplace_occupations_occupation_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workplace_occupations_workplace_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workplace_occupations"`);
  }
}
