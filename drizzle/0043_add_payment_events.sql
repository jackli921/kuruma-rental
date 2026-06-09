CREATE TYPE "public"."payment_event_status" AS ENUM('SUCCEEDED');--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"bookingId" text NOT NULL,
	"stripeEventId" text NOT NULL,
	"stripeCheckoutSessionId" text NOT NULL,
	"stripePaymentIntentId" text,
	"grossJpy" integer NOT NULL,
	"platformFeeJpy" integer NOT NULL,
	"netToPartnerJpy" integer NOT NULL,
	"currency" text DEFAULT 'jpy' NOT NULL,
	"status" "payment_event_status" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_events_operatorId" ON "payment_events" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_payment_events_bookingId" ON "payment_events" USING btree ("bookingId");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_stripeEventId_unique" ON "payment_events" USING btree ("stripeEventId");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_stripeCheckoutSessionId_unique" ON "payment_events" USING btree ("stripeCheckoutSessionId");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_one_success_per_booking" ON "payment_events" USING btree ("bookingId") WHERE status = 'SUCCEEDED';