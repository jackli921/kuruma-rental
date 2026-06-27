import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  findDrift,
  findStaleBaseline,
  parseCreatedIndexes,
  parseDroppedColumns,
  parseDroppedIndexes,
  readLiveMigrationIndexes,
} from './lint-snapshot-index-parity'

describe('parseCreatedIndexes', () => {
  test('extracts (table, name, columns) from a quoted CREATE INDEX', () => {
    const sql = 'CREATE INDEX "idx_accounts_userId" ON "accounts" ("userId");'
    expect(parseCreatedIndexes(sql)).toEqual([
      { table: 'accounts', name: 'idx_accounts_userId', columns: ['userId'] },
    ])
  })

  test('handles IF NOT EXISTS', () => {
    const sql = 'CREATE INDEX IF NOT EXISTS "idx_x" ON "t" ("c");'
    expect(parseCreatedIndexes(sql)).toEqual([{ table: 't', name: 'idx_x', columns: ['c'] }])
  })

  test('handles UNIQUE INDEX with a partial WHERE clause', () => {
    const sql =
      'CREATE UNIQUE INDEX "bookings_idempotency_key" ON "bookings" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;'
    expect(parseCreatedIndexes(sql)).toEqual([
      { table: 'bookings', name: 'bookings_idempotency_key', columns: ['idempotencyKey'] },
    ])
  })

  test('handles unquoted identifiers and USING btree', () => {
    const sql = 'CREATE INDEX idx_x ON t USING btree (c);'
    expect(parseCreatedIndexes(sql)).toEqual([{ table: 't', name: 'idx_x', columns: ['c'] }])
  })

  test('handles CONCURRENTLY (hand-SQL avoids the table lock)', () => {
    const sql = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_x" ON "t" ("c");'
    expect(parseCreatedIndexes(sql)).toEqual([{ table: 't', name: 'idx_x', columns: ['c'] }])
  })

  test('captures composite-index columns', () => {
    const sql = 'CREATE INDEX "idx_x" ON "t" ("a", "b", "c");'
    expect(parseCreatedIndexes(sql)).toEqual([
      { table: 't', name: 'idx_x', columns: ['a', 'b', 'c'] },
    ])
  })

  test('strips ASC/DESC suffix from columns', () => {
    const sql = 'CREATE INDEX "idx_x" ON "t" ("a" ASC, "b" DESC);'
    expect(parseCreatedIndexes(sql)).toEqual([{ table: 't', name: 'idx_x', columns: ['a', 'b'] }])
  })

  test('strips line comments so a `-- CREATE INDEX` does not count', () => {
    const sql = '-- CREATE INDEX "fake" ON "tbl" ("c");\nCREATE INDEX "real" ON "tbl" ("c");'
    expect(parseCreatedIndexes(sql)).toEqual([{ table: 'tbl', name: 'real', columns: ['c'] }])
  })

  test('picks up multiple CREATE INDEX in one file', () => {
    const sql = `
      CREATE INDEX "idx_a" ON "t1" ("c");
      CREATE UNIQUE INDEX "idx_b" ON "t2" ("c");
    `
    expect(parseCreatedIndexes(sql)).toEqual([
      { table: 't1', name: 'idx_a', columns: ['c'] },
      { table: 't2', name: 'idx_b', columns: ['c'] },
    ])
  })

  test('ignores statements that are not CREATE INDEX', () => {
    const sql = 'ALTER TABLE "t" ADD COLUMN "c" text; CREATE TABLE "u" ("id" text);'
    expect(parseCreatedIndexes(sql)).toEqual([])
  })
})

describe('readLiveMigrationIndexes (journal replay)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'snapshot-lint-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function write(name: string, sql: string): void {
    writeFileSync(join(dir, name), sql)
  }

  test('replays creates in journal order', () => {
    write('0001_a.sql', 'CREATE INDEX "idx_a" ON "t" ("c");')
    write('0002_b.sql', 'CREATE INDEX "idx_b" ON "t" ("d");')
    expect(
      readLiveMigrationIndexes(dir)
        .map((i) => i.name)
        .sort(),
    ).toEqual(['idx_a', 'idx_b'])
  })

  test('a later DROP INDEX retires the entry', () => {
    write('0001_a.sql', 'CREATE INDEX "idx_a" ON "t" ("c");')
    write('0002_drop.sql', 'DROP INDEX "idx_a";')
    expect(readLiveMigrationIndexes(dir)).toEqual([])
  })

  test('cascade: DROP COLUMN drops every index covering that column', () => {
    // Mirrors the real 0010 → 0038 sequence: idx_bookings_vehicleId was created
    // by 0010_add-fk-indexes.sql; 0038_slice6_drop_legacy_vehicle_buffer.sql
    // then dropped the column, which Postgres cascades into the index.
    write('0001_create.sql', 'CREATE INDEX "idx_bookings_vehicleId" ON "bookings" ("vehicleId");')
    write(
      '0002_split.sql',
      'CREATE INDEX "idx_bookings_renterId" ON "bookings" ("renterId");\nALTER TABLE "bookings" DROP COLUMN "vehicleId";',
    )
    const live = readLiveMigrationIndexes(dir)
    expect(live.map((i) => i.name).sort()).toEqual(['idx_bookings_renterId'])
  })

  test('cascade ignores DROP COLUMN on a different table', () => {
    write('0001_create.sql', 'CREATE INDEX "idx_t_c" ON "t" ("c");')
    // Dropping `c` on table `u` (different table) must NOT touch idx_t_c.
    write('0002_drop_other.sql', 'ALTER TABLE "u" DROP COLUMN "c";')
    expect(readLiveMigrationIndexes(dir).map((i) => i.name)).toEqual(['idx_t_c'])
  })
})

describe('parseDroppedColumns', () => {
  test('extracts (table, column) from a quoted DROP COLUMN', () => {
    const sql = 'ALTER TABLE "bookings" DROP COLUMN "vehicleId";'
    expect(parseDroppedColumns(sql)).toEqual([{ table: 'bookings', column: 'vehicleId' }])
  })

  test('handles IF EXISTS', () => {
    const sql = 'ALTER TABLE "t" DROP COLUMN IF EXISTS "c";'
    expect(parseDroppedColumns(sql)).toEqual([{ table: 't', column: 'c' }])
  })

  test('handles unquoted identifiers', () => {
    expect(parseDroppedColumns('ALTER TABLE t DROP COLUMN c;')).toEqual([
      { table: 't', column: 'c' },
    ])
  })
})

describe('parseDroppedIndexes', () => {
  test('extracts the name from a DROP INDEX', () => {
    expect(parseDroppedIndexes('DROP INDEX "idx_x";')).toEqual(['idx_x'])
  })

  test('handles IF EXISTS', () => {
    expect(parseDroppedIndexes('DROP INDEX IF EXISTS "idx_x";')).toEqual(['idx_x'])
  })

  test('handles unquoted identifiers', () => {
    expect(parseDroppedIndexes('DROP INDEX idx_x;')).toEqual(['idx_x'])
  })
})

describe('findDrift', () => {
  const ix = (table: string, name: string, columns: string[] = ['c']) => ({
    table,
    name,
    columns,
  })

  test('flags an index in the migration that has no snapshot entry', () => {
    const migrations = [ix('accounts', 'idx_accounts_userId', ['userId'])]
    const snapshot = { tables: { 'public.accounts': { indexes: {} } } }
    expect(findDrift(migrations, snapshot)).toEqual([
      ix('accounts', 'idx_accounts_userId', ['userId']),
    ])
  })

  test('accepts a snapshot entry that DOES declare the index', () => {
    const migrations = [ix('messages', 'idx_messages_threadId', ['threadId'])]
    const snapshot = {
      tables: { 'public.messages': { indexes: { idx_messages_threadId: { name: '...' } } } },
    }
    expect(findDrift(migrations, snapshot)).toEqual([])
  })

  test('respects the baseline allowlist', () => {
    const migrations = [ix('accounts', 'idx_accounts_userId', ['userId'])]
    const snapshot = { tables: { 'public.accounts': { indexes: {} } } }
    const baseline = new Set(['accounts.idx_accounts_userId'])
    expect(findDrift(migrations, snapshot, baseline)).toEqual([])
  })

  test('flags every drift entry, not just the first', () => {
    const migrations = [
      ix('accounts', 'idx_accounts_userId', ['userId']),
      ix('maintenance_logs', 'idx_maintenance_logs_vehicleId', ['vehicleId']),
    ]
    const snapshot = {
      tables: {
        'public.accounts': { indexes: {} },
        'public.maintenance_logs': { indexes: {} },
      },
    }
    expect(findDrift(migrations, snapshot)).toEqual(migrations)
  })

  test('falls back to unprefixed table key when snapshot omits "public." prefix', () => {
    const migrations = [ix('t', 'idx_t_c')]
    const snapshot = { tables: { t: { indexes: { idx_t_c: {} } } } }
    expect(findDrift(migrations, snapshot)).toEqual([])
  })

  test('treats a missing table as drift (no indexes declared at all)', () => {
    const migrations = [ix('orphan', 'idx_orphan_c')]
    const snapshot = { tables: {} }
    expect(findDrift(migrations, snapshot)).toEqual([ix('orphan', 'idx_orphan_c')])
  })
})

describe('findStaleBaseline', () => {
  const ix = (table: string, name: string, columns: string[] = ['c']) => ({
    table,
    name,
    columns,
  })

  test('flags a baseline entry whose index is no longer in any migration', () => {
    // The CREATE was reverted (or the entry was always a typo) — baseline now hides nothing.
    const migrations: never[] = []
    const snapshot = { tables: {} }
    const baseline = new Set(['accounts.idx_accounts_userId'])
    expect(findStaleBaseline(migrations, snapshot, baseline)).toEqual([
      'accounts.idx_accounts_userId',
    ])
  })

  test('flags a baseline entry whose index has been codified into the snapshot', () => {
    // Codification PR landed: index exists in migrations AND in snapshot. BASELINE
    // entry now silently swallows a regression if someone removes the inline `.index()`.
    const migrations = [ix('accounts', 'idx_accounts_userId', ['userId'])]
    const snapshot = {
      tables: { 'public.accounts': { indexes: { idx_accounts_userId: {} } } },
    }
    const baseline = new Set(['accounts.idx_accounts_userId'])
    expect(findStaleBaseline(migrations, snapshot, baseline)).toEqual([
      'accounts.idx_accounts_userId',
    ])
  })

  test('returns empty when every baseline entry still corresponds to undeclared drift', () => {
    const migrations = [ix('accounts', 'idx_accounts_userId', ['userId'])]
    const snapshot = { tables: { 'public.accounts': { indexes: {} } } }
    const baseline = new Set(['accounts.idx_accounts_userId'])
    expect(findStaleBaseline(migrations, snapshot, baseline)).toEqual([])
  })
})
