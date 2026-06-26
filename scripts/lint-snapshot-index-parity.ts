// ENFORCES: every index created in drizzle/*.sql migrations is also declared
// inline in a schema module (reflected in the latest drizzle/meta snapshot).
// SSOT: docs/architecture/modules.md § packages/shared
/**
 * Catch hand-SQL index drift across schema modules.
 *
 * `drizzle-kit` regenerates the snapshot from the TS schema modules, NOT from
 * `drizzle/*.sql`. A `CREATE INDEX` that lives only in hand-SQL — never echoed
 * by an inline `.index(...)` on the table — survives in prod but a future
 * `drizzle-kit pull` (or a schema regen during a migration rebase) would
 * silently drop it. This is the same risk class as issue #1112 (audit M7).
 *
 * How we check:
 *  - Parse every `drizzle/*.sql` for `CREATE INDEX (IF NOT EXISTS)?` and collect
 *    (table, index_name). `DROP INDEX foo` later in the chain retires the entry.
 *  - Read the LATEST `drizzle/meta/<N>_snapshot.json` and inspect each table's
 *    `indexes` map.
 *  - A migration index `foo` on `bar` is "declared in schema" iff
 *    `snapshot.tables["public.bar"].indexes.foo` exists.
 *  - Anything else is drift → fail the lint, unless on the allowlist.
 *
 * Remediation pattern (proven in #1135 for the messaging tables):
 *   1. Add `.index('idx_foo_bar').on(t.bar)` (or the matching `uniqueIndex`)
 *      to the schema module's table definition.
 *   2. `bun run db:generate --custom --name codify_<table>_indexes`, then put
 *      `CREATE INDEX IF NOT EXISTS ...` (the canonical name) inside.
 *   3. After landing: remove the entry from BASELINE here.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface MigrationIndex {
  table: string
  name: string
  columns: string[]
}

export interface DroppedColumn {
  table: string
  column: string
}

/** Parse `CREATE [UNIQUE] INDEX [IF NOT EXISTS] "name" ON "table" (cols...)`.
 *  Captures the column list (leading + trailing) so a later `DROP COLUMN` on
 *  any covered column can drop this index too (Postgres cascades). Strips
 *  line comments so `-- CREATE INDEX ...` doesn't count. */
export function parseCreatedIndexes(sql: string): MigrationIndex[] {
  const cleaned = sql.replace(/--[^\n]*/g, '')
  const re =
    /create\s+(?:unique\s+)?index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?\s+(?:"([^"]+)"|(\w+))\s+on\s+(?:"([^"]+)"|(\w+))\s*(?:using\s+\w+\s*)?\(([^)]+)\)/gi
  const out: MigrationIndex[] = []
  for (const m of cleaned.matchAll(re)) {
    const name = m[1] ?? m[2]
    const table = m[3] ?? m[4]
    const cols = (m[5] ?? '')
      .split(',')
      .map((c) =>
        c
          .trim()
          .replace(/\s+(asc|desc)\b.*$/i, '')
          .replace(/^"|"$/g, ''),
      )
      .filter((c) => c.length > 0)
    if (name && table) out.push({ table, name, columns: cols })
  }
  return out
}

/** Parse `DROP INDEX [IF EXISTS] "name"` so a retired index doesn't get
 *  flagged as drift forever. */
export function parseDroppedIndexes(sql: string): string[] {
  const cleaned = sql.replace(/--[^\n]*/g, '')
  const re = /drop\s+index(?:\s+if\s+exists)?\s+(?:"([^"]+)"|(\w+))/gi
  const out: string[] = []
  for (const m of cleaned.matchAll(re)) {
    const name = m[1] ?? m[2]
    if (name) out.push(name)
  }
  return out
}

/** Parse `ALTER TABLE "t" ... DROP COLUMN [IF EXISTS] "c"`. Postgres cascades
 *  a column drop into every index covering that column, so the lint must too —
 *  otherwise an index created on a since-dropped column is flagged forever as
 *  drift when it's actually gone from the DB. */
export function parseDroppedColumns(sql: string): DroppedColumn[] {
  const cleaned = sql.replace(/--[^\n]*/g, '')
  const re =
    /alter\s+table\s+(?:"([^"]+)"|(\w+))\s+drop\s+column(?:\s+if\s+exists)?\s+(?:"([^"]+)"|(\w+))/gi
  const out: DroppedColumn[] = []
  for (const m of cleaned.matchAll(re)) {
    const table = m[1] ?? m[2]
    const column = m[3] ?? m[4]
    if (table && column) out.push({ table, column })
  }
  return out
}

/** Walk drizzle/*.sql in journal order and net every CREATE INDEX against
 *  later DROP INDEX and column-cascade drops, so the result reflects what's
 *  actually live in the DB — not just what was ever created. (DROP TABLE
 *  cascade isn't handled today; no dropped table in tree has indexes — if one
 *  ever does, extend here.) */
export function readLiveMigrationIndexes(drizzleDir: string): MigrationIndex[] {
  const files = readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const live = new Map<string, MigrationIndex>()
  for (const f of files) {
    const sql = readFileSync(join(drizzleDir, f), 'utf8')
    for (const ix of parseCreatedIndexes(sql)) live.set(ix.name, ix)
    for (const dropped of parseDroppedIndexes(sql)) live.delete(dropped)
    for (const { table, column } of parseDroppedColumns(sql)) {
      for (const [name, ix] of live) {
        if (ix.table === table && ix.columns.includes(column)) live.delete(name)
      }
    }
  }
  return [...live.values()]
}

interface SnapshotShape {
  tables?: Record<string, { indexes?: Record<string, unknown> } | undefined>
}

export function readLatestSnapshot(metaDir: string): SnapshotShape {
  const files = readdirSync(metaDir)
    .filter((f) => /^\d+_snapshot\.json$/.test(f))
    .sort()
  const latest = files.at(-1)
  if (!latest) throw new Error(`no snapshot found in ${metaDir}`)
  return JSON.parse(readFileSync(join(metaDir, latest), 'utf8')) as SnapshotShape
}

/** A migration index `name` on `table` is "declared" iff the snapshot has it
 *  at `tables["public.<table>"].indexes.<name>`. The "public." prefix is how
 *  drizzle-kit namespaces non-schema-qualified tables. */
export function findDrift(
  migrationIndexes: readonly MigrationIndex[],
  snapshot: SnapshotShape,
  baseline: ReadonlySet<string> = new Set(),
): MigrationIndex[] {
  const tables = snapshot.tables ?? {}
  const drift: MigrationIndex[] = []
  for (const mi of migrationIndexes) {
    const key = `${mi.table}.${mi.name}`
    if (baseline.has(key)) continue
    const t = tables[`public.${mi.table}`] ?? tables[mi.table]
    const declared = t?.indexes ?? {}
    if (!(mi.name in declared)) drift.push(mi)
  }
  return drift
}

/** Find BASELINE entries that no longer correspond to live, undeclared drift —
 *  either the index has been dropped from migrations entirely or it has since
 *  been codified into the snapshot. A stale entry hides future regressions
 *  (someone removes the inline `.index()` → snapshot drops it → stale baseline
 *  silently suppresses the resulting drift), so the lint must surface and
 *  reject these alongside positive drift. */
export function findStaleBaseline(
  migrationIndexes: readonly MigrationIndex[],
  snapshot: SnapshotShape,
  baseline: ReadonlySet<string>,
): string[] {
  const tables = snapshot.tables ?? {}
  const liveByKey = new Map(migrationIndexes.map((mi) => [`${mi.table}.${mi.name}`, mi]))
  const stale: string[] = []
  for (const key of baseline) {
    const live = liveByKey.get(key)
    if (!live) {
      // No matching CREATE INDEX in the journal at all — the index was dropped
      // or the entry was malformed.
      stale.push(key)
      continue
    }
    const t = tables[`public.${live.table}`] ?? tables[live.table]
    if (t?.indexes && live.name in t.indexes) {
      // Index now declared in the snapshot — codification landed; remove from BASELINE.
      stale.push(key)
    }
  }
  return stale
}

/**
 * Known drift not yet codified (#1150). Each entry is `<table>.<index_name>`.
 * Drain each via a codification PR: add an inline `.index(...)` / `.uniqueIndex(...)`
 * to the table's schema module, then `CREATE INDEX IF NOT EXISTS` migration.
 *
 * Empty after #1171 / #1172 / #1173 drained the original 5 entries from the
 * audit M7 sweep. SHRINK this set when codifying — never grow it. New drift =
 * a missing schema declaration on a new migration, and that should fail the
 * lint immediately, not be silenced here.
 */
export const BASELINE: ReadonlySet<string> = new Set()

async function main(): Promise<void> {
  const root = new URL('..', import.meta.url).pathname
  const drizzleDir = join(root, 'drizzle')
  const metaDir = join(drizzleDir, 'meta')
  const live = readLiveMigrationIndexes(drizzleDir)
  const snapshot = readLatestSnapshot(metaDir)
  const drift = findDrift(live, snapshot, BASELINE)
  const stale = findStaleBaseline(live, snapshot, BASELINE)

  if (drift.length > 0) {
    console.error(
      `[lint-snapshot-index-parity] ${drift.length} migration index(es) not declared in the latest snapshot:`,
    )
    for (const d of drift) console.error(`  - ${d.table}.${d.name}`)
    console.error(
      '\nRemediation: declare the index inline on the table in packages/shared/src/db/,' +
        '\nthen run `bun run db:generate` so the snapshot picks it up. Or, if the index is' +
        '\nintentionally hand-SQL-only and codification is queued, add the key to BASELINE in' +
        '\nscripts/lint-snapshot-index-parity.ts with a comment naming the tracking issue.',
    )
    process.exit(1)
  }
  if (stale.length > 0) {
    console.error(
      `[lint-snapshot-index-parity] ${stale.length} stale BASELINE entr${
        stale.length === 1 ? 'y' : 'ies'
      } — drift is no longer present (codified or dropped). Remove from BASELINE:`,
    )
    for (const k of stale) console.error(`  - ${k}`)
    process.exit(1)
  }
  const inspected = live.length
  const allowlisted = BASELINE.size
  const backlog = allowlisted > 0 ? ` (${allowlisted} on the codification backlog)` : ''
  console.log(
    `[lint-snapshot-index-parity] ${inspected} migration indexes match the snapshot${backlog}`,
  )
}

if (import.meta.main) {
  void main()
}
