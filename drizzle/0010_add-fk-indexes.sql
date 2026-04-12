-- Issue #88: Postgres does NOT auto-create indexes on FK columns.
-- Without these, every JOIN or WHERE on a FK is a sequential scan.
-- At 2000+ users / thousands of bookings, this causes visible latency.

-- accounts.userId → users.id
CREATE INDEX IF NOT EXISTS "idx_accounts_userId" ON "accounts" ("userId");

-- bookings.renterId → users.id
CREATE INDEX IF NOT EXISTS "idx_bookings_renterId" ON "bookings" ("renterId");

-- bookings.vehicleId → vehicles.id
CREATE INDEX IF NOT EXISTS "idx_bookings_vehicleId" ON "bookings" ("vehicleId");

-- threads.bookingId → bookings.id
CREATE INDEX IF NOT EXISTS "idx_threads_bookingId" ON "threads" ("bookingId");

-- thread_participants.threadId → threads.id
CREATE INDEX IF NOT EXISTS "idx_thread_participants_threadId" ON "thread_participants" ("threadId");

-- thread_participants.userId → users.id
CREATE INDEX IF NOT EXISTS "idx_thread_participants_userId" ON "thread_participants" ("userId");

-- messages.threadId → threads.id
CREATE INDEX IF NOT EXISTS "idx_messages_threadId" ON "messages" ("threadId");

-- messages.senderId → users.id
CREATE INDEX IF NOT EXISTS "idx_messages_senderId" ON "messages" ("senderId");
