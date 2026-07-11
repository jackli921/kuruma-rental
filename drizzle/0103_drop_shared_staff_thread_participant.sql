-- Custom SQL migration file, put your code below! --

-- Drop the legacy shared-staff (DEFAULT_STAFF_ID) participant that ensureThread
-- seeded into every booking thread. Operators now read-scope by
-- threads."operatorId" (#1205) and are NOT thread participants, so a single
-- global staff user seeded across every tenant's threads was dead weight and a
-- latent cross-tenant membership (threadReadScope maps a participant-scope role
-- to "read every thread you belong to"). ensureThread now seeds the renter alone.
--
-- Target: any participant of a booking-linked thread that is NOT that booking's
-- renter -- historically the only other seeded participant. Idempotent: a re-run
-- deletes nothing once every thread carries the renter alone.
DELETE FROM thread_participants tp
USING threads t, bookings b
WHERE tp."threadId" = t.id
  AND t."bookingId" = b.id
  AND tp."userId" <> b."renterId";
