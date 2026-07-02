CREATE TABLE "insurance_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"status" "catalog_template_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insurance_options" ADD COLUMN "templateId" text;--> statement-breakpoint
ALTER TABLE "insurance_options" ADD COLUMN "descriptionOverride" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_templates_key_unique" ON "insurance_templates" USING btree ("key");--> statement-breakpoint
ALTER TABLE "insurance_options" ADD CONSTRAINT "insurance_options_templateId_insurance_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."insurance_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_insurance_options_templateId" ON "insurance_options" USING btree ("templateId");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_options_active_template_unique" ON "insurance_options" USING btree ("operatorId","templateId") WHERE status = 'ACTIVE';--> statement-breakpoint
-- Catalog i18n seed: curated insurance templates (H1 source = DEMO_INSURANCE_TEMPLATES).
-- Ships to production via this migration; the demo seed re-upserts the same rows.
-- Idempotent on the natural key so a rerun / warm DB is a no-op.
INSERT INTO "insurance_templates" ("id", "key", "name", "description") VALUES
	('58dd2265-fddb-499f-be0f-fe1d14d0deae', 'normal', '{"en":"Normal","ja":"ノーマル","zh":"标准"}'::jsonb, '{"en":"Standard collision cover with a 150,000 yen deductible.","ja":"免責額15万円の標準的な車両補償。","zh":"含15万日元自付额的标准碰撞保险。"}'::jsonb),
	('dd11d9a4-cf61-4abe-8618-21de95dd2c45', 'premium', '{"en":"Premium","ja":"プレミアム","zh":"高级"}'::jsonb, '{"en":"Lower out-of-pocket cover with a 250,000 yen deductible.","ja":"自己負担を抑えた補償。免責額25万円。","zh":"降低自付负担的保险，自付额25万日元。"}'::jsonb)
ON CONFLICT ("key") DO NOTHING;