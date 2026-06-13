CREATE TYPE "public"."payment_anomaly_kind" AS ENUM('DOUBLE_PAYMENT', 'AMOUNT_MISMATCH');--> statement-breakpoint
CREATE TABLE "payment_anomalies" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"bookingId" text NOT NULL,
	"kind" "payment_anomaly_kind" NOT NULL,
	"stripeEventId" text NOT NULL,
	"stripeCheckoutSessionId" text NOT NULL,
	"stripePaymentIntentId" text,
	"receivedAmountJpy" integer,
	"expectedAmountJpy" integer,
	"currency" text,
	"resolvedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_anomalies" ADD CONSTRAINT "payment_anomalies_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_anomalies" ADD CONSTRAINT "payment_anomalies_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_anomalies_operatorId" ON "payment_anomalies" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_payment_anomalies_bookingId" ON "payment_anomalies" USING btree ("bookingId");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_anomalies_stripeEventId_unique" ON "payment_anomalies" USING btree ("stripeEventId");