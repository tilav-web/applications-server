import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDetectedCrimesModule1764400000000 implements MigrationInterface {
  name = 'CreateDetectedCrimesModule1764400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "detection_sources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" varchar(200) NOT NULL,
        "code" varchar(60) NULL,
        "description" text NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_detection_sources" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_detection_sources_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "detected_crimes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "case_number" varchar(60) NULL,
        "title" varchar(255) NOT NULL,
        "description" text NULL,
        "report_number" varchar(120) NULL,
        "report_date" TIMESTAMP WITH TIME ZONE NULL,
        "kusp_number" varchar(120) NULL,
        "detected_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "qualification_type" varchar(30) NOT NULL DEFAULT 'PRE_INVESTIGATION',
        "crime_id" uuid NULL,
        "crime_method_id" uuid NULL,
        "mjtk_article" varchar(150) NULL,
        "detection_source_id" uuid NULL,
        "district_id" uuid NULL,
        "department_service_id" uuid NULL,
        "platform" varchar(100) NULL,
        "channel_or_source_url" varchar(500) NULL,
        "suspect_tree" jsonb NULL DEFAULT '[]'::jsonb,
        "estimated_damage" numeric(18,2) NULL,
        "officer_notes" text NULL,
        "status_id" uuid NULL,
        "decision_type_id" uuid NULL,
        "decision_number" varchar(120) NULL,
        "decision_date" TIMESTAMP WITH TIME ZONE NULL,
        "decision_note" text NULL,
        "deadline_at" TIMESTAMP WITH TIME ZONE NULL,
        "sla_days" integer NULL,
        "extended_until" TIMESTAMP WITH TIME ZONE NULL,
        "extension_reason" text NULL,
        "prosecutor_approval_number" varchar(120) NULL,
        "closed_at" TIMESTAMP WITH TIME ZONE NULL,
        "detected_by_id" uuid NULL,
        "created_by_id" uuid NULL,
        "is_deleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMP WITH TIME ZONE NULL,
        "deleted_by_id" uuid NULL,
        CONSTRAINT "PK_detected_crimes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_detected_crimes_case_number" UNIQUE ("case_number"),
        CONSTRAINT "FK_dc_crime" FOREIGN KEY ("crime_id") REFERENCES "crimes"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_crime_method" FOREIGN KEY ("crime_method_id") REFERENCES "crime_methods"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_source" FOREIGN KEY ("detection_source_id") REFERENCES "detection_sources"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_district" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_dept_service" FOREIGN KEY ("department_service_id") REFERENCES "department_services"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_status" FOREIGN KEY ("status_id") REFERENCES "application_statuses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_decision" FOREIGN KEY ("decision_type_id") REFERENCES "decision_types"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_detected_by" FOREIGN KEY ("detected_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dc_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_is_deleted_date" ON "detected_crimes" ("is_deleted", "detected_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_district_id" ON "detected_crimes" ("district_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_status_id" ON "detected_crimes" ("status_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_crime_id" ON "detected_crimes" ("crime_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_detected_crimes_deadline_at" ON "detected_crimes" ("deadline_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "detected_crime_suspects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "detected_crime_id" uuid NOT NULL,
        "citizen_id" uuid NOT NULL,
        "role_in_crime" varchar(40) NOT NULL DEFAULT 'IJROCHI',
        "detention_status" varchar(40) NOT NULL DEFAULT 'ANIQLANMOQDA',
        "is_repeat_offender" boolean NOT NULL DEFAULT false,
        "notes" text NULL,
        CONSTRAINT "PK_detected_crime_suspects" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dc_suspects_crime" FOREIGN KEY ("detected_crime_id") REFERENCES "detected_crimes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dc_suspects_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dc_suspects_crime_id" ON "detected_crime_suspects" ("detected_crime_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dc_suspects_citizen_id" ON "detected_crime_suspects" ("citizen_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "detected_crime_evidences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "detected_crime_id" uuid NOT NULL,
        "evidence_type" varchar(40) NOT NULL DEFAULT 'OTHER',
        "title" varchar(255) NOT NULL,
        "identifier_value" varchar(255) NULL,
        "seized_at" TIMESTAMP WITH TIME ZONE NULL,
        "seized_from_citizen_id" uuid NULL,
        "file_key" varchar(500) NULL,
        "file_name" varchar(255) NULL,
        "notes" text NULL,
        CONSTRAINT "PK_detected_crime_evidences" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dc_evidences_crime" FOREIGN KEY ("detected_crime_id") REFERENCES "detected_crimes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dc_evidences_citizen" FOREIGN KEY ("seized_from_citizen_id") REFERENCES "citizens"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dc_evidences_crime_id" ON "detected_crime_evidences" ("detected_crime_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "detected_crime_evidences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "detected_crime_suspects"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "detected_crimes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "detection_sources"`);
  }
}
