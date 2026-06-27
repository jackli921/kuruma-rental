ALTER TABLE "reviews" DROP CONSTRAINT "reviews_author_subject_per_booking_unique";--> statement-breakpoint
DROP INDEX "reviews_operator_subject_per_booking_unique";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_per_booking_unique" UNIQUE("bookingId","subject");