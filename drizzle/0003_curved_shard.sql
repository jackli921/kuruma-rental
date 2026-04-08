CREATE TYPE "public"."booking_source" AS ENUM('DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'MAINTENANCE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"renterId" text NOT NULL,
	"vehicleId" text NOT NULL,
	"startAt" timestamp with time zone NOT NULL,
	"endAt" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'CONFIRMED' NOT NULL,
	"source" "booking_source" DEFAULT 'DIRECT' NOT NULL,
	"externalId" text,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"seats" integer NOT NULL,
	"transmission" "transmission" NOT NULL,
	"fuelType" text,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"bufferMinutes" integer DEFAULT 60 NOT NULL,
	"minRentalHours" integer,
	"maxRentalHours" integer,
	"advanceBookingHours" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_renterId_users_id_fk" FOREIGN KEY ("renterId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;