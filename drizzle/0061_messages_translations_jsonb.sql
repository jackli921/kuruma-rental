ALTER TABLE "messages" ALTER COLUMN "translations" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "translations" SET DATA TYPE jsonb USING COALESCE(NULLIF("translations", ''), '{}')::jsonb;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "translations" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "translations" SET NOT NULL;