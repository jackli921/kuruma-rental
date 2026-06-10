CREATE TYPE "public"."add_on_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "add_on_options" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priceJpy" integer NOT NULL,
	"status" "add_on_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "add_on_options_operatorId_id_unique" UNIQUE("operatorId","id"),
	CONSTRAINT "add_on_options_price_non_negative" CHECK ("add_on_options"."priceJpy" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "addOnSnapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "add_on_options" ADD CONSTRAINT "add_on_options_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_add_on_options_operatorId" ON "add_on_options" USING btree ("operatorId");--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_options_active_name_unique" ON "add_on_options" USING btree ("operatorId","name") WHERE status = 'ACTIVE';