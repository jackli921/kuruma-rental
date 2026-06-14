ALTER TABLE "bookings" DROP CONSTRAINT "bookings_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "fee_schedules" DROP CONSTRAINT "fee_schedules_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "insurance_options" DROP CONSTRAINT "insurance_options_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_log" DROP CONSTRAINT "notification_log_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_anomalies" DROP CONSTRAINT "payment_anomalies_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_events" DROP CONSTRAINT "payment_events_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "vehicle_classes" DROP CONSTRAINT "vehicle_classes_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "add_on_options" DROP CONSTRAINT "add_on_options_operatorId_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_options" ADD CONSTRAINT "insurance_options_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_anomalies" ADD CONSTRAINT "payment_anomalies_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_classes" ADD CONSTRAINT "vehicle_classes_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_options" ADD CONSTRAINT "add_on_options_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;