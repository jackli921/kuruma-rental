CREATE TYPE "public"."document_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('IDP', 'PASSPORT');--> statement-breakpoint
CREATE TABLE "renter_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"renterId" text NOT NULL,
	"type" "document_type" NOT NULL,
	"storageKey" text NOT NULL,
	"status" "document_status" DEFAULT 'PENDING' NOT NULL,
	"expiryDate" date,
	"verifiedAt" timestamp with time zone,
	"verifierId" text,
	"rejectionReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renter_documents" ADD CONSTRAINT "renter_documents_renterId_users_id_fk" FOREIGN KEY ("renterId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_documents" ADD CONSTRAINT "renter_documents_verifierId_users_id_fk" FOREIGN KEY ("verifierId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_renter_documents_renterId" ON "renter_documents" USING btree ("renterId");--> statement-breakpoint
CREATE INDEX "idx_renter_documents_verifierId" ON "renter_documents" USING btree ("verifierId");--> statement-breakpoint
CREATE INDEX "idx_renter_documents_status" ON "renter_documents" USING btree ("status");