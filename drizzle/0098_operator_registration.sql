CREATE TYPE "public"."operator_application_business_type" AS ENUM('INDIVIDUAL', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."operator_application_fleet_size" AS ENUM('1-5', '6-20', '21-50', '50+');--> statement-breakpoint
CREATE TYPE "public"."operator_application_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."audit_event_kind" ADD VALUE 'OPERATOR_APPLICATION_APPROVED';--> statement-breakpoint
ALTER TYPE "public"."audit_event_kind" ADD VALUE 'OPERATOR_APPLICATION_REJECTED';--> statement-breakpoint
CREATE TABLE "operator_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "operator_application_status" DEFAULT 'PENDING' NOT NULL,
	"businessName" text NOT NULL,
	"contactName" text NOT NULL,
	"contactEmail" text NOT NULL,
	"contactPhone" text NOT NULL,
	"serviceArea" text NOT NULL,
	"estimatedFleetSize" "operator_application_fleet_size" NOT NULL,
	"website" text,
	"businessLicenseNumber" text,
	"businessType" "operator_application_business_type",
	"message" text,
	"submittedLocale" text NOT NULL,
	"operatorId" text,
	"reviewedByUserId" text,
	"reviewedAt" timestamp with time zone,
	"reviewerNotes" text,
	"rejectionReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_applications" ADD CONSTRAINT "operator_applications_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_applications" ADD CONSTRAINT "operator_applications_reviewedByUserId_users_id_fk" FOREIGN KEY ("reviewedByUserId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_operator_applications_status" ON "operator_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_operator_applications_operatorId" ON "operator_applications" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_operator_applications_reviewedByUserId" ON "operator_applications" USING btree ("reviewedByUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_applications_live_email_unique" ON "operator_applications" USING btree ("contactEmail") WHERE status in ('PENDING','APPROVED');