CREATE TYPE "public"."luggage_size" AS ENUM('SMALL', 'MEDIUM', 'LARGE');--> statement-breakpoint
ALTER TABLE "vehicle_classes" ADD COLUMN "luggageSize" "luggage_size" DEFAULT 'MEDIUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "luggageCapacity" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "luggageSize" "luggage_size";