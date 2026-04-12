-- bookings.status is filtered in nearly every booking query (dashboard,
-- fleet overview, status transitions). Without an index, every query is
-- a sequential scan. See issue #140.
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
