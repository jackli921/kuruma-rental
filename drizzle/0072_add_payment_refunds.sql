CREATE TYPE "public"."payment_refund_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"bookingId" text NOT NULL,
	"operatorId" text NOT NULL,
	"stripePaymentIntentId" text NOT NULL,
	"stripeRefundId" text,
	"amountJpy" integer NOT NULL,
	"status" "payment_refund_status" DEFAULT 'PENDING' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_refunds_operatorId" ON "payment_refunds" USING btree ("operatorId");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_bookingId_unique" ON "payment_refunds" USING btree ("bookingId");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_stripeRefundId_unique" ON "payment_refunds" USING btree ("stripeRefundId") WHERE "stripeRefundId" is not null;