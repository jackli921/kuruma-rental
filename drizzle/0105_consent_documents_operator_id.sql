ALTER TABLE "consent_documents" DROP CONSTRAINT "consent_documents_type_version_locale_unique";--> statement-breakpoint
ALTER TABLE "consent_documents" ADD COLUMN "operatorId" text;--> statement-breakpoint
ALTER TABLE "consent_documents" ADD CONSTRAINT "consent_documents_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_documents_platform_tvl_unique" ON "consent_documents" USING btree ("type","version","locale") WHERE "consent_documents"."operatorId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_documents_operator_tvl_unique" ON "consent_documents" USING btree ("operatorId","type","version","locale") WHERE "consent_documents"."operatorId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "consent_documents_operator_idx" ON "consent_documents" USING btree ("operatorId");