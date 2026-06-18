CREATE TABLE "compliance_alert_log" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"vehicleId" text NOT NULL,
	"documentType" text NOT NULL,
	"thresholdBand" text NOT NULL,
	"recipient" text NOT NULL,
	"sentAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_alert_log_band_unique" UNIQUE("vehicleId","documentType","thresholdBand")
);
--> statement-breakpoint
ALTER TABLE "compliance_alert_log" ADD CONSTRAINT "compliance_alert_log_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_alert_log" ADD CONSTRAINT "compliance_alert_log_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_compliance_alert_log_operatorId" ON "compliance_alert_log" USING btree ("operatorId");