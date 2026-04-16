-- Issue #254: maintenance_logs.vehicleId FK was missing an index.
-- Every findByVehicleId query was doing a sequential scan.
CREATE INDEX IF NOT EXISTS "idx_maintenance_logs_vehicleId" ON "maintenance_logs" ("vehicleId");
