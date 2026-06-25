ALTER TABLE "consent_acceptances" ADD COLUMN "documentSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD COLUMN "signatureCanonicalVersion" text;