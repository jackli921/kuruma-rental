ALTER TABLE "add_on_options" ADD COLUMN "templateId" text;--> statement-breakpoint
ALTER TABLE "add_on_options" ADD COLUMN "descriptionOverride" jsonb;--> statement-breakpoint
ALTER TABLE "add_on_options" ADD CONSTRAINT "add_on_options_templateId_add_on_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."add_on_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_add_on_options_templateId" ON "add_on_options" USING btree ("templateId");--> statement-breakpoint
CREATE UNIQUE INDEX "add_on_options_active_template_unique" ON "add_on_options" USING btree ("operatorId","templateId") WHERE status = 'ACTIVE';