CREATE TABLE "review_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reviewId" text NOT NULL,
	"reporterUserId" text NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reviewId_reviews_id_fk" FOREIGN KEY ("reviewId") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporterUserId_users_id_fk" FOREIGN KEY ("reporterUserId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_one_per_reporter" ON "review_reports" USING btree ("reviewId","reporterUserId");--> statement-breakpoint
CREATE INDEX "idx_review_reports_reporterUserId" ON "review_reports" USING btree ("reporterUserId");