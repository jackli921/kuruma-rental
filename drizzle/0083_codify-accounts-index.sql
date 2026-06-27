-- Codify the hand-SQL accounts.userId FK index from 0010_add-fk-indexes.sql.
-- The index already exists in prod, so use IF NOT EXISTS — this migration's
-- job is to bring the drizzle snapshot into agreement with the live DB, not
-- to create something new. See #1171 / #1150.
CREATE INDEX IF NOT EXISTS "idx_accounts_userId" ON "accounts" USING btree ("userId");
