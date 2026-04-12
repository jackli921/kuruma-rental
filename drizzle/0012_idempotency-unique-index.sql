-- Custom SQL migration file, put your code below! --
CREATE UNIQUE INDEX "bookings_idempotency_key" ON "bookings" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;