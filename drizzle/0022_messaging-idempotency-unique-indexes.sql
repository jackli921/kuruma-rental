CREATE UNIQUE INDEX "threads_idempotency_key" ON "threads" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE UNIQUE INDEX "messages_idempotency_key" ON "messages" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
