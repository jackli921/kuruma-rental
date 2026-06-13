CREATE TABLE "regions" (
	"id" text PRIMARY KEY NOT NULL,
	"parentId" text,
	"nameEn" text NOT NULL,
	"nameJa" text NOT NULL,
	"nameZh" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "regionId" text;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parentId_regions_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_regions_parentId" ON "regions" USING btree ("parentId");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_regionId_regions_id_fk" FOREIGN KEY ("regionId") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_locations_regionId" ON "locations" USING btree ("regionId");