CREATE TYPE "public"."custody_state" AS ENUM('AT_STATION', 'IN_TRANSIT');--> statement-breakpoint
CREATE TYPE "public"."custody_settlement_state" AS ENUM('ACCRUING', 'CLOSED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."handoff_phase" AS ENUM('DEPARTURE', 'ARRIVAL');--> statement-breakpoint
CREATE TYPE "public"."movement_leg_kind" AS ENUM('RENTAL', 'STAFF_REPOSITION', 'TRANSFER');--> statement-breakpoint
CREATE TABLE "custody_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"ownerOperatorId" text NOT NULL,
	"hostOperatorId" text NOT NULL,
	"hostLocationId" text NOT NULL,
	"receivedAt" timestamp with time zone NOT NULL,
	"departedAt" timestamp with time zone,
	"openedByLegId" text,
	"closedByLegId" text,
	"dailyRateJpySnapshot" integer DEFAULT 0 NOT NULL,
	"handoffFeeJpySnapshot" integer DEFAULT 0 NOT NULL,
	"accruedJpy" integer,
	"settlementState" "custody_settlement_state" DEFAULT 'ACCRUING' NOT NULL,
	"settlementRef" text,
	"settledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_periods_state_target_unique" UNIQUE("id","vehicleId","hostOperatorId","hostLocationId"),
	CONSTRAINT "custody_periods_close_after_open" CHECK ("custody_periods"."departedAt" IS NULL OR "custody_periods"."departedAt" >= "custody_periods"."receivedAt"),
	CONSTRAINT "custody_periods_rate_non_negative" CHECK ("custody_periods"."dailyRateJpySnapshot" >= 0),
	CONSTRAINT "custody_periods_handoff_fee_non_negative" CHECK ("custody_periods"."handoffFeeJpySnapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "handoff_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"legId" text NOT NULL,
	"phase" "handoff_phase" NOT NULL,
	"vehicleId" text NOT NULL,
	"actorUserId" text NOT NULL,
	"actorOperatorId" text NOT NULL,
	"atOperatorId" text NOT NULL,
	"atLocationId" text NOT NULL,
	"capturedAt" timestamp with time zone NOT NULL,
	"fuelPercent" integer,
	"odometerKm" integer,
	"damageReported" boolean DEFAULT false NOT NULL,
	"conditionNotes" text,
	"photoStorageKeys" text[] DEFAULT '{}' NOT NULL,
	"supersedesReceiptId" text,
	"idempotencyKey" text NOT NULL,
	"requestFingerprint" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_receipts_id_legId_phase_unique" UNIQUE("id","legId","phase"),
	CONSTRAINT "handoff_receipts_no_self_supersede" CHECK ("handoff_receipts"."supersedesReceiptId" IS NULL OR "handoff_receipts"."supersedesReceiptId" <> "handoff_receipts"."id"),
	CONSTRAINT "handoff_receipts_fuel_range" CHECK ("handoff_receipts"."fuelPercent" IS NULL OR ("handoff_receipts"."fuelPercent" BETWEEN 0 AND 100)),
	CONSTRAINT "handoff_receipts_odometer_non_negative" CHECK ("handoff_receipts"."odometerKm" IS NULL OR "handoff_receipts"."odometerKm" >= 0)
);
--> statement-breakpoint
CREATE TABLE "movement_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"kind" "movement_leg_kind" NOT NULL,
	"bookingId" text,
	"fromOperatorId" text NOT NULL,
	"fromLocationId" text NOT NULL,
	"toOperatorId" text NOT NULL,
	"toLocationId" text NOT NULL,
	"plannedStartAt" timestamp with time zone NOT NULL,
	"plannedEndAt" timestamp with time zone NOT NULL,
	"departedAt" timestamp with time zone,
	"receivedAt" timestamp with time zone,
	"voidedAt" timestamp with time zone,
	"checklistSnapshot" text[],
	"idempotencyKey" text NOT NULL,
	"requestFingerprint" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_legs_id_vehicleId_unique" UNIQUE("id","vehicleId"),
	CONSTRAINT "movement_legs_kind_booking" CHECK (("movement_legs"."kind"::text = 'RENTAL') = ("movement_legs"."bookingId" IS NOT NULL)),
	CONSTRAINT "movement_legs_planned_window" CHECK ("movement_legs"."plannedEndAt" > "movement_legs"."plannedStartAt"),
	CONSTRAINT "movement_legs_received_after_departed" CHECK ("movement_legs"."receivedAt" IS NULL OR ("movement_legs"."departedAt" IS NOT NULL AND "movement_legs"."receivedAt" >= "movement_legs"."departedAt")),
	CONSTRAINT "movement_legs_void_only_undeparted" CHECK ("movement_legs"."voidedAt" IS NULL OR "movement_legs"."departedAt" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "receiptChecklist" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "custodyState" "custody_state";--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "physicalHostOperatorId" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "physicalLocationId" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "inFlightLegId" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "openCustodyPeriodId" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "heldOffline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "autoRelistOnReceipt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "homewardPromoPercent" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "homewardPromoCutoffAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_ownerOperatorId_operators_id_fk" FOREIGN KEY ("ownerOperatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_openedByLegId_movement_legs_id_fk" FOREIGN KEY ("openedByLegId") REFERENCES "public"."movement_legs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_closedByLegId_movement_legs_id_fk" FOREIGN KEY ("closedByLegId") REFERENCES "public"."movement_legs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_host_location_fk" FOREIGN KEY ("hostOperatorId","hostLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_owner_vehicle_fk" FOREIGN KEY ("ownerOperatorId","vehicleId") REFERENCES "public"."vehicles"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_opened_leg_vehicle_fk" FOREIGN KEY ("openedByLegId","vehicleId") REFERENCES "public"."movement_legs"("id","vehicleId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_periods" ADD CONSTRAINT "custody_periods_closed_leg_vehicle_fk" FOREIGN KEY ("closedByLegId","vehicleId") REFERENCES "public"."movement_legs"("id","vehicleId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_legId_movement_legs_id_fk" FOREIGN KEY ("legId") REFERENCES "public"."movement_legs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_actorUserId_users_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_actorOperatorId_operators_id_fk" FOREIGN KEY ("actorOperatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_correction_same_end_fk" FOREIGN KEY ("supersedesReceiptId","legId","phase") REFERENCES "public"."handoff_receipts"("id","legId","phase") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_leg_vehicle_fk" FOREIGN KEY ("legId","vehicleId") REFERENCES "public"."movement_legs"("id","vehicleId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_receipts" ADD CONSTRAINT "handoff_receipts_at_location_fk" FOREIGN KEY ("atOperatorId","atLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_from_location_fk" FOREIGN KEY ("fromOperatorId","fromLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_to_location_fk" FOREIGN KEY ("toOperatorId","toLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_custody_periods_vehicleId" ON "custody_periods" USING btree ("vehicleId");--> statement-breakpoint
CREATE INDEX "idx_custody_periods_ownerOperatorId" ON "custody_periods" USING btree ("ownerOperatorId");--> statement-breakpoint
CREATE INDEX "idx_custody_periods_hostOperatorId" ON "custody_periods" USING btree ("hostOperatorId");--> statement-breakpoint
CREATE INDEX "idx_custody_periods_hostLocationId" ON "custody_periods" USING btree ("hostLocationId");--> statement-breakpoint
CREATE INDEX "idx_custody_periods_openedByLegId" ON "custody_periods" USING btree ("openedByLegId");--> statement-breakpoint
CREATE INDEX "idx_custody_periods_closedByLegId" ON "custody_periods" USING btree ("closedByLegId");--> statement-breakpoint
CREATE UNIQUE INDEX "custody_periods_one_open_per_vehicle" ON "custody_periods" USING btree ("vehicleId") WHERE "custody_periods"."departedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_legId" ON "handoff_receipts" USING btree ("legId");--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_vehicleId" ON "handoff_receipts" USING btree ("vehicleId");--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_actorUserId" ON "handoff_receipts" USING btree ("actorUserId");--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_actorOperatorId" ON "handoff_receipts" USING btree ("actorOperatorId");--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_atOperatorId" ON "handoff_receipts" USING btree ("atOperatorId");--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_supersedesReceiptId" ON "handoff_receipts" USING btree ("supersedesReceiptId");--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_atLocationId" ON "handoff_receipts" USING btree ("atLocationId");--> statement-breakpoint
CREATE INDEX "idx_handoff_receipts_phase" ON "handoff_receipts" USING btree ("phase");--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_receipts_idempotencyKey_unique" ON "handoff_receipts" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_receipts_canonical_unique" ON "handoff_receipts" USING btree ("legId","phase") WHERE "handoff_receipts"."supersedesReceiptId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_receipts_supersedes_unique" ON "handoff_receipts" USING btree ("supersedesReceiptId") WHERE "handoff_receipts"."supersedesReceiptId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_movement_legs_vehicleId" ON "movement_legs" USING btree ("vehicleId");--> statement-breakpoint
CREATE INDEX "idx_movement_legs_bookingId" ON "movement_legs" USING btree ("bookingId");--> statement-breakpoint
CREATE INDEX "idx_movement_legs_fromOperatorId" ON "movement_legs" USING btree ("fromOperatorId");--> statement-breakpoint
CREATE INDEX "idx_movement_legs_toOperatorId" ON "movement_legs" USING btree ("toOperatorId");--> statement-breakpoint
CREATE INDEX "idx_movement_legs_fromLocationId" ON "movement_legs" USING btree ("fromLocationId");--> statement-breakpoint
CREATE INDEX "idx_movement_legs_toLocationId" ON "movement_legs" USING btree ("toLocationId");--> statement-breakpoint
CREATE INDEX "idx_movement_legs_pending" ON "movement_legs" USING btree ("vehicleId") WHERE "movement_legs"."receivedAt" IS NULL AND "movement_legs"."voidedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "movement_legs_idempotencyKey_unique" ON "movement_legs" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "movement_legs_booking_vehicle_unique" ON "movement_legs" USING btree ("bookingId","vehicleId") WHERE "movement_legs"."bookingId" IS NOT NULL AND "movement_legs"."voidedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "movement_legs_one_in_flight_per_vehicle" ON "movement_legs" USING btree ("vehicleId") WHERE "movement_legs"."departedAt" IS NOT NULL AND "movement_legs"."receivedAt" IS NULL AND "movement_legs"."voidedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_physical_location_fk" FOREIGN KEY ("physicalHostOperatorId","physicalLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vehicles_physicalHostOperatorId" ON "vehicles" USING btree ("physicalHostOperatorId");--> statement-breakpoint
CREATE INDEX "idx_vehicles_physicalLocationId" ON "vehicles" USING btree ("physicalLocationId");--> statement-breakpoint
CREATE INDEX "idx_vehicles_inFlightLegId" ON "vehicles" USING btree ("inFlightLegId");--> statement-breakpoint
CREATE INDEX "idx_vehicles_openCustodyPeriodId" ON "vehicles" USING btree ("openCustodyPeriodId");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_homeward_promo_pair" CHECK (("vehicles"."homewardPromoPercent" IS NULL) = ("vehicles"."homewardPromoCutoffAt" IS NULL));--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_homeward_promo_percent_range" CHECK ("vehicles"."homewardPromoPercent" IS NULL OR ("vehicles"."homewardPromoPercent" BETWEEN 1 AND 100));