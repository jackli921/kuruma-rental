-- Codify the hand-SQL maintenance_logs.vehicleId FK index from
-- 0020_add-maintenance-logs-vehicle-index.sql. Index already exists in prod —
-- IF NOT EXISTS brings the drizzle snapshot into agreement with the live DB.
-- See #1172 / #1150.
CREATE INDEX IF NOT EXISTS "idx_maintenance_logs_vehicleId" ON "maintenance_logs" USING btree ("vehicleId");
