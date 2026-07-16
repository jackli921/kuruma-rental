-- #1553: consent_acceptances is a legal, append-only evidence ledger. In place of a
-- symmetric HMAC record signature (dropped in #1553), row integrity is enforced at the
-- database via role separation: the application runtime connects as `kuruma_runtime`,
-- a reduced-privilege, NON-OWNER role that may INSERT/SELECT but never UPDATE/DELETE
-- this table. The owner role that runs migrations/seed is the break-glass path for
-- GDPR erasure and corrections. A non-owner role is required so REVOKE actually binds
-- (owners keep implicit privileges).
--
-- The role is created NOLOGIN — a pure privilege group. Production attaches a LOGIN
-- password out of band and points DATABASE_URL_RUNTIME at it (deploy runbook); local,
-- CI, and tests reach these privileges with `SET LOCAL ROLE kuruma_runtime`.
--
-- Role/grant DDL is not expressible in drizzle's table builder, so this is a raw SQL
-- migration and is snapshot-invisible (no schema-vs-snapshot drift), like the trigger
-- seal in 0106.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuruma_runtime') THEN
    CREATE ROLE kuruma_runtime NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO kuruma_runtime;
--> statement-breakpoint
-- Baseline: read every table and write every table (INSERT/UPDATE/DELETE)...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kuruma_runtime;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kuruma_runtime;
--> statement-breakpoint
-- ...and inherit the same on objects created by future migrations (all run as owner).
-- NOTE: future append-only ledger tables must add their own REVOKE UPDATE, DELETE (#1553).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kuruma_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kuruma_runtime;
--> statement-breakpoint
-- Append-only seal: the runtime role keeps SELECT + INSERT on the ledger, but never
-- UPDATE or DELETE. Corrections and erasure run through the owner (break-glass) role.
REVOKE UPDATE, DELETE ON consent_acceptances FROM kuruma_runtime;
