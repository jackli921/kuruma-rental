CREATE TYPE "public"."region_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."region_type" AS ENUM('PREFECTURE', 'CITY', 'AREA');--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "type" "region_type";--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "assignable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "status" "region_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "regions_slug_unique" ON "regions" USING btree ("slug");