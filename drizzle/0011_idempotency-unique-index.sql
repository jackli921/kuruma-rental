-- Partial unique index: prevent duplicate bookings from client retries.
-- Only enforced when idempotencyKey is provided (nullable column).
-- Clients send a UUID per booking intent; retries send the same key.
CREATE UNIQUE INDEX "bookings_idempotency_key"
  ON "bookings" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
