CREATE TYPE "public"."insurance_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "insurance_options" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"dailyPriceJpy" integer NOT NULL,
	"deductibleJpy" integer,
	"status" "insurance_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_options_operatorId_id_unique" UNIQUE("operatorId","id"),
	CONSTRAINT "insurance_options_daily_price_non_negative" CHECK ("insurance_options"."dailyPriceJpy" >= 0),
	CONSTRAINT "insurance_options_deductible_non_negative" CHECK ("insurance_options"."deductibleJpy" IS NULL OR "insurance_options"."deductibleJpy" >= 0)
);
--> statement-breakpoint
ALTER TABLE "insurance_options" ADD CONSTRAINT "insurance_options_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_insurance_options_operatorId" ON "insurance_options" USING btree ("operatorId");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_options_active_name_unique" ON "insurance_options" USING btree ("operatorId","name") WHERE status = 'ACTIVE';