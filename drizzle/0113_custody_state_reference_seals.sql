-- One-way custody §3: state⇔reference seals. Hand-written because the FKs are
-- circular across drizzle modules (vehicles→movement_legs/custody_periods→vehicles).
-- Drizzle never diffs custom SQL, so these constraints cause no snapshot drift.
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_in_flight_leg_fk"
    FOREIGN KEY ("inFlightLegId", "id")
    REFERENCES "movement_legs" ("id", "vehicleId") ON DELETE RESTRICT,
  ADD CONSTRAINT "vehicles_open_custody_period_fk"
    FOREIGN KEY ("openCustodyPeriodId", "id", "physicalHostOperatorId", "physicalLocationId")
    REFERENCES "custody_periods" ("id", "vehicleId", "hostOperatorId", "hostLocationId") ON DELETE RESTRICT,
  ADD CONSTRAINT "vehicles_custody_three_way_check" CHECK (
    ("custodyState" IS NULL
      AND "physicalHostOperatorId" IS NULL AND "physicalLocationId" IS NULL
      AND "inFlightLegId" IS NULL AND "openCustodyPeriodId" IS NULL)
    OR ("custodyState" = 'IN_TRANSIT'
      AND "physicalHostOperatorId" IS NULL AND "physicalLocationId" IS NULL
      AND "inFlightLegId" IS NOT NULL AND "openCustodyPeriodId" IS NULL)
    OR ("custodyState" = 'AT_STATION'
      AND "physicalHostOperatorId" IS NOT NULL AND "physicalLocationId" IS NOT NULL
      AND "inFlightLegId" IS NULL AND "openCustodyPeriodId" IS NOT NULL)
  );
--> statement-breakpoint
-- §6: a receipt matches its leg's endpoint. Deferred so a recovery re-target
-- (leg to* updated in the same tx) is always checked against the final pair.
--
-- Two conventions every RAISE in this file follows. (1) The message names the
-- offending ROW, not just the mismatched value: these are DEFERRED triggers, so
-- they fire at COMMIT with no statement context — in a tx that wrote several
-- receipts, a message without ids cannot say which one failed. (2) Each sets
-- CONSTRAINT explicitly; plpgsql leaves err.constraint NULL otherwise, and that
-- is the field the API's pg-errors.ts `getViolatedConstraint` dispatches on, so
-- an unset one degrades a mappable domain error into a generic 500.
CREATE OR REPLACE FUNCTION handoff_receipt_endpoint_check() RETURNS trigger AS $$
DECLARE
  leg_from text;
  leg_to text;
BEGIN
  SELECT "fromLocationId", "toLocationId" INTO leg_from, leg_to
    FROM "movement_legs" WHERE "id" = NEW."legId";
  IF NEW."phase" = 'ARRIVAL' AND NEW."atLocationId" <> leg_to THEN
    RAISE EXCEPTION 'handoff_receipts_endpoint_match: receipt % on leg %: ARRIVAL recorded at % but leg arrives at %',
      NEW."id", NEW."legId", NEW."atLocationId", leg_to
      USING ERRCODE = '23514', CONSTRAINT = 'handoff_receipts_endpoint_match';
  END IF;
  IF NEW."phase" = 'DEPARTURE' AND NEW."atLocationId" <> leg_from THEN
    RAISE EXCEPTION 'handoff_receipts_endpoint_match: receipt % on leg %: DEPARTURE recorded at % but leg departs from %',
      NEW."id", NEW."legId", NEW."atLocationId", leg_from
      USING ERRCODE = '23514', CONSTRAINT = 'handoff_receipts_endpoint_match';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER handoff_receipts_endpoint_match
  AFTER INSERT ON "handoff_receipts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION handoff_receipt_endpoint_check();
--> statement-breakpoint
-- §6 rev.8: the endpoint guard is BIDIRECTIONAL — updating a leg's endpoint
-- pair must not orphan a receipt already pinned to that leg-end. Deferred so
-- the recovery flow (re-target to*, then insert the matching ARRIVAL receipt,
-- same tx) is checked once, against the final state.
CREATE OR REPLACE FUNCTION movement_leg_endpoint_receipts_check() RETURNS trigger AS $$
DECLARE
  l record;
  orphaned_receipt_id text;
BEGIN
  -- §3 rev.9: NEW is an event-time snapshot — evaluate the FINAL row.
  SELECT "fromLocationId", "toLocationId" INTO l FROM "movement_legs" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- SELECT INTO, not PERFORM: the offending receipt id is the whole diagnostic.
  SELECT r."id" INTO orphaned_receipt_id FROM "handoff_receipts" r
    WHERE r."legId" = NEW."id"
      AND ((r."phase" = 'ARRIVAL' AND r."atLocationId" <> l."toLocationId")
        OR (r."phase" = 'DEPARTURE' AND r."atLocationId" <> l."fromLocationId"))
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'movement_legs_endpoint_receipts: leg % endpoint update orphans receipt %',
      NEW."id", orphaned_receipt_id
      USING ERRCODE = '23514', CONSTRAINT = 'movement_legs_endpoint_receipts';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER movement_legs_endpoint_receipts
  AFTER UPDATE OF "fromOperatorId", "fromLocationId", "toOperatorId", "toLocationId" ON "movement_legs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION movement_leg_endpoint_receipts_check();
--> statement-breakpoint
-- §3 rev.9: lifecycle triggers. The composite FKs prove the referenced row
-- BELONGS to the car — an FK is equally satisfied by a received leg or a
-- closed period. These deferred triggers assert the lifecycle state at commit,
-- from BOTH directions, completing the seal. EVERY function re-reads the
-- current row by id: a deferred trigger's NEW is captured at event time, so an
-- insert-untracked-then-place transaction queues an insert event whose NEW is
-- the pre-placement row — checking NEW would fail a perfectly legal sequence.
CREATE OR REPLACE FUNCTION vehicle_custody_lifecycle_check() RETURNS trigger AS $$
DECLARE
  v record;
BEGIN
  SELECT "custodyState", "inFlightLegId", "openCustodyPeriodId" INTO v
    FROM "vehicles" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF; -- row deleted later in tx: nothing to seal
  IF v."custodyState" = 'IN_TRANSIT' THEN
    PERFORM 1 FROM "movement_legs" l
      WHERE l."id" = v."inFlightLegId"
        AND l."departedAt" IS NOT NULL AND l."receivedAt" IS NULL AND l."voidedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vehicles_custody_lifecycle: vehicle % is IN_TRANSIT but leg % is not in flight',
        NEW."id", v."inFlightLegId"
        USING ERRCODE = '23514', CONSTRAINT = 'vehicles_custody_lifecycle';
    END IF;
  ELSIF v."custodyState" = 'AT_STATION' THEN
    PERFORM 1 FROM "custody_periods" p
      WHERE p."id" = v."openCustodyPeriodId" AND p."departedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vehicles_custody_lifecycle: vehicle % is AT_STATION but period % is not open',
        NEW."id", v."openCustodyPeriodId"
        USING ERRCODE = '23514', CONSTRAINT = 'vehicles_custody_lifecycle';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER vehicles_custody_lifecycle
  AFTER INSERT OR UPDATE ON "vehicles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vehicle_custody_lifecycle_check();
--> statement-breakpoint
-- The reverse direction: ANY update that ends a leg's in-flight state
-- (receivedAt/voidedAt set, OR departedAt cleared — the rev.4 OF-list missed
-- that) or closes a period fails at commit while a vehicle still references
-- it — the §5 transitions must update the vehicle in the same transaction.
CREATE OR REPLACE FUNCTION movement_leg_backref_check() RETURNS trigger AS $$
DECLARE
  l record;
  referencing_vehicle_id text;
BEGIN
  SELECT "departedAt", "receivedAt", "voidedAt" INTO l
    FROM "movement_legs" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF l."departedAt" IS NULL OR l."receivedAt" IS NOT NULL OR l."voidedAt" IS NOT NULL THEN
    SELECT v."id" INTO referencing_vehicle_id FROM "vehicles" v WHERE v."inFlightLegId" = NEW."id" LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'movement_legs_vehicle_backref: leg % is no longer in flight but vehicle % still references it',
        NEW."id", referencing_vehicle_id
        USING ERRCODE = '23514', CONSTRAINT = 'movement_legs_vehicle_backref';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER movement_legs_vehicle_backref
  AFTER UPDATE OF "departedAt", "receivedAt", "voidedAt" ON "movement_legs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION movement_leg_backref_check();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION custody_period_backref_check() RETURNS trigger AS $$
DECLARE
  p record;
  referencing_vehicle_id text;
BEGIN
  SELECT "departedAt" INTO p FROM "custody_periods" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p."departedAt" IS NOT NULL THEN
    SELECT v."id" INTO referencing_vehicle_id FROM "vehicles" v WHERE v."openCustodyPeriodId" = NEW."id" LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'custody_periods_vehicle_backref: period % closed while vehicle % still references it as open',
        NEW."id", referencing_vehicle_id
        USING ERRCODE = '23514', CONSTRAINT = 'custody_periods_vehicle_backref';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER custody_periods_vehicle_backref
  AFTER UPDATE OF "departedAt" ON "custody_periods"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION custody_period_backref_check();
