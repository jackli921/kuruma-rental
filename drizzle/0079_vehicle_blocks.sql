CREATE TYPE "public"."vehicle_block_kind" AS ENUM('MAINTENANCE', 'OUT_OF_SERVICE', 'MANUAL');--> statement-breakpoint
CREATE TABLE "vehicle_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"vehicleId" text NOT NULL,
	"startAt" timestamp with time zone NOT NULL,
	"endAt" timestamp with time zone NOT NULL,
	"kind" "vehicle_block_kind" NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_blocks_end_after_start" CHECK ("vehicle_blocks"."endAt" > "vehicle_blocks"."startAt")
);
--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_operatorId_vehicleId_fk" FOREIGN KEY ("operatorId","vehicleId") REFERENCES "public"."vehicles"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vehicle_blocks_vehicleId" ON "vehicle_blocks" USING btree ("vehicleId");--> statement-breakpoint
CREATE INDEX "idx_vehicle_blocks_operatorId" ON "vehicle_blocks" USING btree ("operatorId");