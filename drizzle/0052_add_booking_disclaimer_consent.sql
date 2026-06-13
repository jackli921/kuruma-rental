ALTER TABLE "bookings" ADD COLUMN "disclaimerAcknowledgedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "disclaimerTermsVersion" text;