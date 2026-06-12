ALTER TABLE "locations" DROP CONSTRAINT "locations_turnaround_non_negative";--> statement-breakpoint
-- #551: backfill BEFORE adding the constraint, or the ADD would fail on any
-- existing row below the new floor. Lifts sub-floor turnarounds to the 60-min
-- minimum (the smallest realistic servicing gap). Idempotent: re-running is a no-op.
UPDATE "locations" SET "defaultTurnaroundMinutes" = 60 WHERE "defaultTurnaroundMinutes" < 60;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_turnaround_min_60" CHECK ("locations"."defaultTurnaroundMinutes" >= 60);