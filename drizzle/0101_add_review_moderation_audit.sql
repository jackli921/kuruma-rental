ALTER TABLE "reviews" ADD COLUMN "moderatedBy" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "moderatedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderatedBy_users_id_fk" FOREIGN KEY ("moderatedBy") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reviews_moderatedBy" ON "reviews" USING btree ("moderatedBy");