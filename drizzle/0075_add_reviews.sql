CREATE TYPE "public"."review_author_role" AS ENUM('RENTER', 'OPERATOR');--> statement-breakpoint
CREATE TYPE "public"."review_moderation_status" AS ENUM('VISIBLE', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."review_subject" AS ENUM('OPERATOR', 'VEHICLE', 'RENTER');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"bookingId" text NOT NULL,
	"operatorId" text NOT NULL,
	"authorUserId" text NOT NULL,
	"authorRole" "review_author_role" NOT NULL,
	"subject" "review_subject" NOT NULL,
	"subjectVehicleId" text,
	"subjectClassId" text,
	"overall" integer NOT NULL,
	"subRatings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comment" text,
	"moderationStatus" "review_moderation_status" DEFAULT 'VISIBLE' NOT NULL,
	"revealDeadlineAt" timestamp with time zone NOT NULL,
	"submittedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"publishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_author_subject_per_booking_unique" UNIQUE("bookingId","authorUserId","subject"),
	CONSTRAINT "reviews_overall_range_chk" CHECK ("reviews"."overall" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_subject_pairing_chk" CHECK (("reviews"."authorRole" = 'OPERATOR') = ("reviews"."subject" = 'RENTER')),
	CONSTRAINT "reviews_vehicle_subject_chk" CHECK (("reviews"."subject" = 'VEHICLE') = ("reviews"."subjectVehicleId" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_authorUserId_users_id_fk" FOREIGN KEY ("authorUserId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subjectVehicleId_vehicles_id_fk" FOREIGN KEY ("subjectVehicleId") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subjectClassId_vehicle_classes_id_fk" FOREIGN KEY ("subjectClassId") REFERENCES "public"."vehicle_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reviews_authorUserId" ON "reviews" USING btree ("authorUserId");--> statement-breakpoint
CREATE INDEX "idx_reviews_operator_published" ON "reviews" USING btree ("operatorId","publishedAt");--> statement-breakpoint
CREATE INDEX "idx_reviews_subject_vehicle" ON "reviews" USING btree ("subjectVehicleId");--> statement-breakpoint
CREATE INDEX "idx_reviews_subject_class" ON "reviews" USING btree ("subjectClassId");--> statement-breakpoint
CREATE INDEX "idx_reviews_reveal_due" ON "reviews" USING btree ("revealDeadlineAt") WHERE "reviews"."publishedAt" IS NULL;