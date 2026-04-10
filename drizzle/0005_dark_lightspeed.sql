ALTER TABLE "bookings" ADD COLUMN "effectiveEndAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "totalPrice" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellationFee" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelledAt" timestamp with time zone;