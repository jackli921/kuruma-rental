ALTER TABLE "vehicles" ADD COLUMN "licensePlate" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_licensePlate_unique" UNIQUE("licensePlate");