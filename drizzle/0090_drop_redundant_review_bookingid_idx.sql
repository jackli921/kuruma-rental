ALTER TABLE "reviews" DROP CONSTRAINT "reviews_subject_per_booking_unique";--> statement-breakpoint
DROP INDEX "idx_reviews_bookingId";--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_subject_per_booking_unique" ON "reviews" USING btree ("bookingId","subject");