CREATE TYPE "public"."consent_doc_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."consent_method" AS ENUM('CLICKWRAP', 'ESIGN', 'IMPORTED');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('RENTER_TOS', 'PRIVACY_POLICY', 'RENTER_LIABILITY', 'OPERATOR_AGREEMENT');--> statement-breakpoint
CREATE TABLE "consent_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"documentId" text NOT NULL,
	"consentType" "consent_type" NOT NULL,
	"userId" text NOT NULL,
	"operatorId" text,
	"operatorMembershipId" text,
	"actorRole" text,
	"bookingId" text,
	"acceptedAt" timestamp with time zone NOT NULL,
	"context" jsonb,
	"ipAddress" text,
	"userAgent" text,
	"method" "consent_method" DEFAULT 'CLICKWRAP' NOT NULL,
	"recordSignature" text,
	"signingKeyId" text,
	"signatureRef" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_liability_booking_chk" CHECK (("consent_acceptances"."consentType" = 'RENTER_LIABILITY') = ("consent_acceptances"."bookingId" IS NOT NULL)),
	CONSTRAINT "consent_operator_agreement_chk" CHECK (("consent_acceptances"."consentType" = 'OPERATOR_AGREEMENT') = ("consent_acceptances"."operatorId" IS NOT NULL)),
	CONSTRAINT "consent_membership_implies_operator_chk" CHECK ("consent_acceptances"."operatorMembershipId" IS NULL OR "consent_acceptances"."operatorId" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "consent_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "consent_type" NOT NULL,
	"version" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"acceptanceLabel" text NOT NULL,
	"contentHash" text NOT NULL,
	"status" "consent_doc_status" DEFAULT 'DRAFT' NOT NULL,
	"effectiveFrom" timestamp with time zone NOT NULL,
	"publishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_documents_type_version_locale_unique" UNIQUE("type","version","locale"),
	CONSTRAINT "consent_documents_id_type_unique" UNIQUE("id","type")
);
--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_operatorMembershipId_operator_memberships_id_fk" FOREIGN KEY ("operatorMembershipId") REFERENCES "public"."operator_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_document_type_fk" FOREIGN KEY ("documentId","consentType") REFERENCES "public"."consent_documents"("id","type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_unique_booking_liability" ON "consent_acceptances" USING btree ("bookingId") WHERE "consent_acceptances"."bookingId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_unique_user_document" ON "consent_acceptances" USING btree ("userId","documentId") WHERE "consent_acceptances"."bookingId" IS NULL AND "consent_acceptances"."operatorId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_unique_operator_document" ON "consent_acceptances" USING btree ("operatorId","documentId") WHERE "consent_acceptances"."operatorId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "consent_acceptances_document_type_idx" ON "consent_acceptances" USING btree ("documentId","consentType");--> statement-breakpoint
CREATE INDEX "consent_acceptances_membership_idx" ON "consent_acceptances" USING btree ("operatorMembershipId");