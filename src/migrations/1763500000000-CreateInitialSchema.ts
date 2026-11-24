import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Boshlang'ich sxema migratsiyasi (Idempotent).
 * Yangi production muhitida (`DB_SYNCHRONIZE=false`, `migrationsRun: true`) barcha asosiy
 * jadvallarni keyingi migratsiyalar (1763600000000+) ishlashidan oldin xavfsiz yaratadi.
 * Mavjud bazalarda `IF NOT EXISTS` tufayli hech narsani o'zgartirmaydi.
 */
export class CreateInitialSchema1763500000000 implements MigrationInterface {
  name = 'CreateInitialSchema1763500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // 1. PostgreSQL Enum turlari (idempotent)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "auth_role_enum" AS ENUM (
          'SUPER_ADMIN', 'BOSS', 'STAFF', 'DISTRICT_OFFICER',
          'ADMIN', 'INSPECTOR', 'OPERATOR', 'USER'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "crimes_gravity_enum" AS ENUM (
          'UNCHA_OGIR_BOLMAGAN', 'ORTA_OGIR', 'OGIR', 'JUDA_OGIR'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "application_custom_fields_type_enum" AS ENUM (
          'TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'IMAGES', 'FILES', 'SELECT',
          'CITIZEN', 'DISTRICT', 'CRIME', 'CARD', 'TRANSFER', 'STRING'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "transfers_status_enum" AS ENUM (
          'KUTILMOQDA', 'MUVAFFAQIYATLI', 'BEKOR_QILINDI'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "transfer_custom_fields_type_enum" AS ENUM (
          'TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'IMAGES', 'FILES', 'SELECT',
          'CARD', 'CITIZEN', 'BANK', 'PAYMENT_PROVIDER', 'STRING'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // 2. Auth va Users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "username" varchar(100) NOT NULL UNIQUE,
        "password" varchar(255) NOT NULL,
        "role" "auth_role_enum" NOT NULL DEFAULT 'SUPER_ADMIN',
        "is_root" boolean NOT NULL DEFAULT false,
        "hashed_refresh_token" varchar(255),
        CONSTRAINT "PK_auth" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "first_name" varchar(100),
        "last_name" varchar(100),
        "phone_number" varchar(30),
        "auth_id" uuid NOT NULL UNIQUE,
        "telegram_chat_id" varchar(64),
        "telegram_username" varchar(100),
        "telegram_first_name" varchar(120),
        "telegram_link_token" varchar(64),
        "telegram_link_expires_at" TIMESTAMP WITH TIME ZONE,
        "notification_prefs" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "FK_users_auth" FOREIGN KEY ("auth_id") REFERENCES "auth"("id") ON DELETE CASCADE
      )
    `);

    // 3. Master ma'lumotnomalar
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "districts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(150),
        CONSTRAINT "PK_districts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_assigned_districts" (
        "user_id" uuid NOT NULL,
        "district_id" uuid NOT NULL,
        CONSTRAINT "PK_user_assigned_districts" PRIMARY KEY ("user_id", "district_id"),
        CONSTRAINT "FK_uad_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_uad_district" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "mahallas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(150) NOT NULL,
        "district_id" uuid NOT NULL,
        "tracking_id" varchar(100),
        CONSTRAINT "PK_mahallas" PRIMARY KEY ("id"),
        CONSTRAINT "FK_mahallas_district" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crimes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "article" varchar(255),
        "title" varchar(255),
        "category" varchar(150),
        "gravity" "crimes_gravity_enum" DEFAULT 'ORTA_OGIR',
        "description" text,
        CONSTRAINT "PK_crimes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crime_methods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" text NOT NULL UNIQUE,
        "group_name" varchar(150) NOT NULL DEFAULT 'Boshqa',
        "code" varchar(50),
        "description" text,
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_crime_methods" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "application_statuses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(120) NOT NULL UNIQUE,
        "code" varchar(60),
        "color" varchar(50) NOT NULL DEFAULT 'blue',
        "description" text,
        "category" varchar(30) NOT NULL DEFAULT 'OPEN',
        "tracks_sla" boolean NOT NULL DEFAULT true,
        "default_sla_days" int DEFAULT 10,
        "legal_article" varchar(150),
        "requires_decision" boolean NOT NULL DEFAULT false,
        "requires_rejection_reason" boolean NOT NULL DEFAULT false,
        "is_default" boolean NOT NULL DEFAULT false,
        "sort_order" int NOT NULL DEFAULT 0,
        CONSTRAINT "PK_application_statuses" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "occupation_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(255) NOT NULL UNIQUE,
        "code" varchar(50),
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_occupation_categories" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "occupations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "category_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "code" varchar(50),
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_occupations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_occupations_category" FOREIGN KEY ("category_id") REFERENCES "occupation_categories"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "application_sources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(255) NOT NULL UNIQUE,
        "code" varchar(50),
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_application_sources" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "department_services" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(255) NOT NULL UNIQUE,
        "short_name" varchar(50),
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_department_services" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rejection_reasons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(255) NOT NULL UNIQUE,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_rejection_reasons" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "decision_types" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(255) NOT NULL UNIQUE,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_decision_types" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "banks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(150),
        "code" varchar(50),
        "mfo" varchar(10),
        "is_active" boolean DEFAULT true,
        CONSTRAINT "PK_banks" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "name" varchar(100),
        "code" varchar(50) UNIQUE,
        CONSTRAINT "PK_payment_providers" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "suspect_field_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "key" varchar(100) NOT NULL UNIQUE,
        "label" varchar(150) NOT NULL,
        "category" varchar(100) NOT NULL DEFAULT 'Umumiy',
        "icon" varchar(50),
        "description" text,
        "sample_value" varchar(255),
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_suspect_field_configs" PRIMARY KEY ("id")
      )
    `);

    // 4. Fuqarolar, Kartalar, Raqamli identifikatorlar va Telefonlar
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "citizens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "first_name" varchar(100),
        "last_name" varchar(100),
        "middle_name" varchar(100),
        "passport" varchar(20),
        "pinfl" varchar(14),
        "phone_number" varchar(24),
        "birth_date" date,
        "gender" varchar(10),
        "address" varchar(255),
        "district_id" uuid,
        "mahalla_id" uuid,
        "occupation_category_id" uuid,
        "occupation_id" uuid,
        "workplace_id" uuid,
        "work_position" varchar(200),
        CONSTRAINT "PK_citizens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_citizens_district" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_citizens_mahalla" FOREIGN KEY ("mahalla_id") REFERENCES "mahallas"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_citizens_occ_cat" FOREIGN KEY ("occupation_category_id") REFERENCES "occupation_categories"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_citizens_occ" FOREIGN KEY ("occupation_id") REFERENCES "occupations"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "card_number" varchar(20),
        "masked_number" varchar(25),
        "expire_date" varchar(10),
        "full_name" varchar(255),
        "citizen_id" uuid,
        "bank_id" uuid,
        CONSTRAINT "PK_cards" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cards_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_cards_bank" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "phones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "phone_number" varchar(24) NOT NULL UNIQUE,
        "formatted_number" varchar(35),
        "operator" varchar(60),
        "citizen_id" uuid,
        "is_primary" boolean NOT NULL DEFAULT false,
        "label" varchar(120),
        "notes" text,
        CONSTRAINT "PK_phones" PRIMARY KEY ("id"),
        CONSTRAINT "FK_phones_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "digital_identifiers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "type" varchar(60) NOT NULL,
        "type_label" varchar(150),
        "raw_value" varchar(255) NOT NULL,
        "normalized_value" varchar(255) NOT NULL,
        "citizen_id" uuid,
        "notes" text,
        CONSTRAINT "PK_digital_identifiers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_digital_identifiers_type_val" UNIQUE ("type", "normalized_value"),
        CONSTRAINT "FK_digital_identifiers_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE SET NULL
      )
    `);

    // 5. Arizalar va To'lov o'tkazmalari (o'zaro FK mavjud bo'lgani uchun applications avval, keyin transfers)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "applications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "application_number" varchar(50),
        "description" text,
        "officer_notes" text,
        "suspect_tree" jsonb DEFAULT '[]'::jsonb,
        "status" varchar(50) DEFAULT 'YANGI',
        "status_id" uuid,
        "date" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "deadline_at" TIMESTAMP WITH TIME ZONE,
        "sla_days" int,
        "extended_until" TIMESTAMP WITH TIME ZONE,
        "extension_reason" text,
        "prosecutor_approval_number" varchar(120),
        "prosecutor_approval_date" TIMESTAMP WITH TIME ZONE,
        "decision_number" varchar(120),
        "decision_date" TIMESTAMP WITH TIME ZONE,
        "decision_note" text,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "citizen_id" uuid,
        "crime_id" uuid,
        "crime_method_id" uuid,
        "district_id" uuid,
        "card_id" uuid,
        "transfer_id" uuid,
        "source_id" uuid,
        "department_service_id" uuid,
        "rejection_reason_id" uuid,
        "decision_type_id" uuid,
        "workplace_id" uuid,
        "work_position" varchar(200),
        "created_by_id" uuid,
        "is_deleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by_id" uuid,
        CONSTRAINT "PK_applications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_applications_status" FOREIGN KEY ("status_id") REFERENCES "application_statuses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_crime" FOREIGN KEY ("crime_id") REFERENCES "crimes"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_crime_method" FOREIGN KEY ("crime_method_id") REFERENCES "crime_methods"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_district" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_card" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_source" FOREIGN KEY ("source_id") REFERENCES "application_sources"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_dept_service" FOREIGN KEY ("department_service_id") REFERENCES "department_services"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_rej_reason" FOREIGN KEY ("rejection_reason_id") REFERENCES "rejection_reasons"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_dec_type" FOREIGN KEY ("decision_type_id") REFERENCES "decision_types"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "transfers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "transaction_id" varchar(100) UNIQUE,
        "amount" numeric(18, 2),
        "currency" varchar(10) DEFAULT 'UZS',
        "status" "transfers_status_enum" DEFAULT 'KUTILMOQDA',
        "transfer_date" varchar(20),
        "transfer_time" varchar(20),
        "transfer_at" TIMESTAMP WITH TIME ZONE,
        "application_id" uuid,
        "payment_provider_id" uuid,
        "sender_card_id" uuid,
        "receiver_card_id" uuid,
        "card_id" uuid,
        "destination_type" varchar(30) NOT NULL DEFAULT 'CARD',
        "receiver_identifier_id" uuid,
        "destination_label" varchar(255),
        "destination_details" jsonb,
        CONSTRAINT "PK_transfers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transfers_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_transfers_provider" FOREIGN KEY ("payment_provider_id") REFERENCES "payment_providers"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_transfers_sender_card" FOREIGN KEY ("sender_card_id") REFERENCES "cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_transfers_receiver_card" FOREIGN KEY ("receiver_card_id") REFERENCES "cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_transfers_card" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_transfers_receiver_ident" FOREIGN KEY ("receiver_identifier_id") REFERENCES "digital_identifiers"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "application_custom_fields" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "application_id" uuid,
        "label" varchar(255),
        "key" varchar(100),
        "type" "application_custom_fields_type_enum" DEFAULT 'STRING',
        "value" jsonb,
        "citizen_id" uuid,
        "card_id" uuid,
        "crime_id" uuid,
        "district_id" uuid,
        "transfer_id" uuid,
        "order" int DEFAULT 0,
        CONSTRAINT "PK_application_custom_fields" PRIMARY KEY ("id"),
        CONSTRAINT "FK_acf_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_acf_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_acf_card" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_acf_crime" FOREIGN KEY ("crime_id") REFERENCES "crimes"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_acf_district" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_acf_transfer" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "transfer_custom_fields" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "transfer_id" uuid,
        "label" varchar(255),
        "key" varchar(100),
        "type" "transfer_custom_fields_type_enum" DEFAULT 'STRING',
        "value" jsonb,
        "card_id" uuid,
        "citizen_id" uuid,
        "bank_id" uuid,
        "payment_provider_id" uuid,
        "order" int DEFAULT 0,
        CONSTRAINT "PK_transfer_custom_fields" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tcf_transfer" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tcf_card" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_tcf_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_tcf_bank" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_tcf_provider" FOREIGN KEY ("payment_provider_id") REFERENCES "payment_providers"("id") ON DELETE SET NULL
      )
    `);

    // 6. Hujjatlar va Shablonlar
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "application_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "application_id" uuid,
        "detected_crime_id" uuid,
        "title" varchar(255) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "file_key" varchar(500) NOT NULL,
        "file_url" varchar(1000) NOT NULL,
        "file_type" varchar(20) NOT NULL DEFAULT 'docx',
        "size" bigint NOT NULL DEFAULT 0,
        "version" int NOT NULL DEFAULT 1,
        "doc_key" varchar(100),
        "created_by_id" uuid,
        CONSTRAINT "PK_application_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_app_docs_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "title" varchar(255) NOT NULL,
        "title_krill" varchar(255),
        "description" text,
        "category" varchar(100),
        "file_key" varchar(500) NOT NULL,
        "file_key_krill" varchar(500),
        "file_name" varchar(255) NOT NULL,
        "file_size" bigint NOT NULL DEFAULT 0,
        "version" int NOT NULL DEFAULT 1,
        "doc_key" varchar(100),
        "is_active" boolean NOT NULL DEFAULT true,
        "available_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_by_id" uuid,
        CONSTRAINT "PK_document_templates" PRIMARY KEY ("id")
      )
    `);

    // 7. Intelligence bog'liqliklari va Audit / System Settings
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "entity_application_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "application_id" uuid NOT NULL,
        "citizen_id" uuid,
        "card_id" uuid,
        "phone_id" uuid,
        "identifier_id" uuid,
        "role" varchar(30) NOT NULL DEFAULT 'RELATED',
        "source" varchar(30) NOT NULL DEFAULT 'AUTO_SYNC',
        "note" varchar(255),
        CONSTRAINT "PK_entity_application_links" PRIMARY KEY ("id"),
        CONSTRAINT "FK_eal_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_eal_citizen" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_eal_card" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_eal_phone" FOREIGN KEY ("phone_id") REFERENCES "phones"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_eal_identifier" FOREIGN KEY ("identifier_id") REFERENCES "digital_identifiers"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" varchar(64),
        "username" varchar(128),
        "role" varchar(64),
        "action" varchar(64) NOT NULL DEFAULT 'API_REQUEST',
        "entity_type" varchar(64),
        "entity_id" varchar(128),
        "summary" varchar(512),
        "details" jsonb,
        "method" varchar(16) NOT NULL,
        "path" varchar(512) NOT NULL,
        "ip" varchar(64),
        "user_agent" varchar(256),
        "status_code" int NOT NULL DEFAULT 200,
        "is_success" boolean NOT NULL DEFAULT true,
        "severity" varchar(16) NOT NULL DEFAULT 'INFO',
        "duration_ms" int NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "system_settings" (
        "key" varchar(100) NOT NULL,
        "value" varchar(500) NOT NULL,
        "description" varchar(255),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_system_settings" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(): Promise<void> {
    // Boshlang'ich sxemani rollback paytida yo'q qilmaymiz (ma'lumot yo'qotilishining oldini olish uchun)
  }
}
