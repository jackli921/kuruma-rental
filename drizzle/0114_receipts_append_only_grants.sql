-- One-way custody §6: handoff_receipts is immutable handover evidence — the
-- second append-only ledger in this schema. A repository that simply exposes no
-- update/delete method is NOT the enforcement: any future caller, script, or
-- raw-SQL fix could silently rewrite a receipt after the fact. Mirrors the
-- consent-ledger seal (#1553, drizzle/0111): the application runtime connects as
-- `kuruma_runtime`, a reduced-privilege NON-OWNER role that may INSERT/SELECT
-- this table but never UPDATE/DELETE it. Corrections go through the §6
-- supersession chain (a NEW row citing supersedesReceiptId), never an in-place
-- edit; the owner role that runs migrations/seed stays the break-glass path.
--
-- 0111 already created the role and set ALTER DEFAULT PRIVILEGES, so a table
-- created by a later migration (handoff_receipts, in 0112) inherits full DML.
-- This migration is exactly the REVOKE that 0111's closing note requires of
-- every new append-only ledger.
--
-- Role/grant DDL is not expressible in drizzle's table builder, so this is a raw
-- SQL migration and is snapshot-invisible (no schema-vs-snapshot drift), like
-- the trigger seals in 0106/0113.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuruma_runtime') THEN
    CREATE ROLE kuruma_runtime NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- Explicit, not inherited: a DB restored or branched before 0111's default
-- privileges took effect would otherwise leave the runtime role unable to write
-- receipts at all. GRANT first, then REVOKE — order matters.
GRANT SELECT, INSERT ON handoff_receipts TO kuruma_runtime;
--> statement-breakpoint
-- Append-only seal: SELECT + INSERT stay, UPDATE/DELETE never.
REVOKE UPDATE, DELETE ON handoff_receipts FROM kuruma_runtime;
