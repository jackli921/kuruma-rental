ALTER TYPE "public"."role" ADD VALUE 'OPERATOR_OWNER';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'OPERATOR_STAFF';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'PLATFORM_ADMIN';--> statement-breakpoint
CREATE TABLE "operators" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"pre_auth_handoff_url" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operators_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "operatorId" text;--> statement-breakpoint
ALTER TABLE "vehicle_classes" ADD COLUMN "operatorId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "operatorId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_classes" ADD CONSTRAINT "vehicle_classes_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_operatorId" ON "users" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_vehicle_classes_operatorId" ON "vehicle_classes" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_vehicles_operatorId" ON "vehicles" USING btree ("operatorId");