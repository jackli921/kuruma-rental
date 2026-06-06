CREATE TYPE "public"."notification_kind" AS ENUM('OPERATOR_BOOKING_ALERT', 'RENTER_BOOKING_CONFIRM');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" text PRIMARY KEY NOT NULL,
	"bookingId" text NOT NULL,
	"operatorId" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"channel" text DEFAULT 'EMAIL' NOT NULL,
	"recipient" text NOT NULL,
	"locale" text NOT NULL,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"providerMessageId" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotencyKey" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_idempotency_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notification_log_bookingId" ON "notification_log" USING btree ("bookingId");--> statement-breakpoint
CREATE INDEX "idx_notification_log_operatorId" ON "notification_log" USING btree ("operatorId");