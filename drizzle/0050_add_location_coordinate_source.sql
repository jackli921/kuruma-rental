CREATE TYPE "public"."coordinate_source" AS ENUM('GEOCODED', 'MANUAL');--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "coordinate_source" "coordinate_source";