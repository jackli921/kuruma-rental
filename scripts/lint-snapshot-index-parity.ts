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

/** Walk `s` from `from` to find the next `(` and return the index of its
 *  matching `)`. Tracks nesting so `lower(email)` inside an outer paren list
 *  doesn't fool the scanner into closing early. Returns null if unbalanced. */
function findBalancedParens(s: string, from: number): { open: number; close: number } | null {
  const open = s.indexOf('(', from)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return { open, close: i }
    }
  }
  return null
}

/** Split `s` on `sep` at paren-depth 0 — so `coalesce(a, b), c` yields two
 *  terms, not three. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''
  for (const c of s) {
    if (c === '(') {
      depth++
      buf += c
    } else if (c === ')') {
      depth--
      buf += c
    } else if (c === sep && depth === 0) {
      out.push(buf)
      buf = ''
    } else {
      buf += c
    }
  }
  if (buf.length > 0) out.push(buf)
  return out
}

// Tokens that appear inside a column term but aren't column references.
// `nulls first/last`, `collate ...`, sort direction — strip when extracting.
const COL_SUFFIX_KEYWORDS = new Set(['asc', 'desc', 'nulls', 'first', 'last', 'collate'])
// Common immutable functions used in expression indexes. Filtered out of
// extracted identifiers so `lower("email")` yields `["email"]`, not
// `["lower", "email"]`. Cascade matching is over column names only.
const FUNCTION_NAMES = new Set([
  'lower',
  'upper',
  'coalesce',
  'concat',
  'trim',
  'btrim',
  'ltrim',
  'rtrim',
  'substring',
  'date_trunc',
  'extract',
  'to_tsvector',
  'to_tsquery',
])

/** Extract the column names referenced by one term of an index column list.
 *  Handles: bare `"col"` / `col`, opclass suffix (`"col" gin_trgm_ops`),
 *  ASC/DESC + NULLS FIRST/LAST, and function calls (`lower("email")`).
 *  Returns the underlying column references so a later DROP COLUMN cascade
 *  can match them. */
function extractColumnsFromTerm(term: string): string[] {
  // Strip opclass suffix: a trailing `\w+_ops` / `\w+_pattern_ops` token
  // (gin_trgm_ops, text_pattern_ops, varchar_pattern_ops, jsonb_path_ops, ...).
  const stripped = term
    .replace(/\s+\w+_(?:pattern_)?ops\s*$/i, '')
    .replace(/\s+(asc|desc)\b.*$/i, '')
    .trim()

  // Fast-path: bare identifier (quoted or unquoted) — return as-is.
  const bare = stripped.match(/^"([^"]+)"$|^([A-Za-z_][A-Za-z0-9_]*)$/)
  if (bare) {
    const name = bare[1] ?? bare[2]
    return name ? [name] : []
  }

  // Expression: pull every identifier, drop keywords + known function names.
  const tokenRe = /"([^"]+)"|\b([A-Za-z_][A-Za-z0-9_]*)\b/g
  const out: string[] = []
  for (const m of stripped.matchAll(tokenRe)) {
    const name = m[1] ?? m[2]
    if (!name) continue
    const lower = name.toLowerCase()
    if (COL_SUFFIX_KEYWORDS.has(lower)) continue
    if (FUNCTION_NAMES.has(lower)) continue
    out.push(name)
  }
  return out
}

// Optional `[schema.]` prefix on a table reference — accepts `public.t`,
// `"public"."t"`, and the unqualified forms. We discard the schema (the lint
// only cares about indexes in the default schema, and drizzle snapshots use
// the `public.` prefix uniformly).
const SCHEMA_PREFIX = String.raw`(?:(?:"[^"]+"|\w+)\s*\.\s*)?`

/** Parse `CREATE [UNIQUE] INDEX [IF NOT EXISTS] "name" ON "table" (cols...)`.
 *  Captures the underlying column references (including those inside
 *  expression indexes like `lower("email")`) so a later `DROP COLUMN` on any
 *  covered column can drop this index too (Postgres cascades). Handles
 *  schema-qualified tables (`"public"."t"`), USING clauses, opclass suffixes,
 *  and trailing WHERE predicates. Strips line comments so `-- CREATE INDEX ...`
 *  doesn't count. */
export function parseCreatedIndexes(sql: string): MigrationIndex[] {
  const cleaned = sql.replace(/--[^\n]*/g, '')
  // Match up through the optional `USING <method>` — the column list itself is
  // grabbed by the balanced-paren scanner below so nested parens (expression
  // indexes) don't break the column capture.
  const prefixRe = new RegExp(
    String.raw`create\s+(?:unique\s+)?index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?\s+(?:"([^"]+)"|(\w+))\s+on\s+${SCHEMA_PREFIX}(?:"([^"]+)"|(\w+))\s*(?:using\s+\w+\s*)?`,
    'gi',
  )
  const out: MigrationIndex[] = []
  for (const m of cleaned.matchAll(prefixRe)) {
    const name = m[1] ?? m[2]
    const table = m[3] ?? m[4]
    if (!name || !table) continue
    const after = (m.index ?? 0) + m[0].length
    const parens = findBalancedParens(cleaned, after)
    if (!parens) continue
    const inner = cleaned.slice(parens.open + 1, parens.close)
    const columns: string[] = []
    for (const term of splitTopLevel(inner, ',')) {
      for (const col of extractColumnsFromTerm(term)) {
        if (col.length > 0) columns.push(col)
      }
    }
    out.push({ table, name, columns })
  }
  return out
}

/** Parse `DROP INDEX [IF EXISTS] [schema.]"name"` so a retired index doesn't
 *  get flagged as drift forever. */
export function parseDroppedIndexes(sql: string): string[] {
  const cleaned = sql.replace(/--[^\n]*/g, '')
  const re = new RegExp(
    String.raw`drop\s+index(?:\s+if\s+exists)?\s+${SCHEMA_PREFIX}(?:"([^"]+)"|(\w+))`,
    'gi',
  )
  const out: string[] = []
  for (const m of cleaned.matchAll(re)) {
    const name = m[1] ?? m[2]
    if (name) out.push(name)
  }
  return out
}

/** Parse `ALTER TABLE [ONLY] [schema.]"t" <actions>` and pull every
 *  `DROP COLUMN` from the actions list — Postgres allows compound actions
 *  separated by `,` (e.g. `DROP CONSTRAINT fk, DROP COLUMN a, DROP COLUMN b`),
 *  which `pg_dump` emits and the old regex missed. The cascade then drops
 *  every index covering those columns; otherwise an index on a since-dropped
 *  column is flagged as drift forever when it's actually gone from the DB. */
export function parseDroppedColumns(sql: string): DroppedColumn[] {
  const cleaned = sql.replace(/--[^\n]*/g, '')
  // Capture (table, action-list) per ALTER TABLE statement, then scan the
  // action list for every DROP COLUMN.
  const stmtRe = new RegExp(
    String.raw`alter\s+table\s+(?:only\s+)?${SCHEMA_PREFIX}(?:"([^"]+)"|(\w+))\s+([^;]+)`,
    'gi',
  )
  const dropColRe = /drop\s+column(?:\s+if\s+exists)?\s+(?:"([^"]+)"|(\w+))/gi
  const out: DroppedColumn[] = []
  for (const stmt of cleaned.matchAll(stmtRe)) {
    const table = stmt[1] ?? stmt[2]
    const actions = stmt[3] ?? ''
    if (!table) continue
    for (const m of actions.matchAll(dropColRe)) {
      const column = m[1] ?? m[2]
      if (column) out.push({ table, column })
    }
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
      // Snapshot the entries before iterating: `live.delete()` inside a live
      // `Map.entries()` iterator works per spec but the safer idiom never has
      // to rely on the runtime's iterator semantics.
      for (const [name, ix] of [...live]) {
        if (ix.table === table && ix.columns.includes(column)) live.delete(name)
      }
    }
  }
  return [...live.values()]
}

export interface SnapshotShape {
  tables?: Record<string, { indexes?: Record<string, unknown> } | undefined>
}

/** Runtime guard for the small slice of the drizzle snapshot the lint reads.
 *  The full snapshot is large and versioned by drizzle-kit; we only depend on
 *  `tables[name].indexes` being a name → object map. This guard rejects shapes
 *  that would have us swallow `undefined.indexes` or treat a non-object as a
 *  bag of indexes. */
export function isSnapshotShape(v: unknown): v is SnapshotShape {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const tables = (v as { tables?: unknown }).tables
  if (tables === undefined) return true
  if (tables === null || typeof tables !== 'object' || Array.isArray(tables)) return false
  for (const t of Object.values(tables)) {
    if (t === undefined) continue
    if (t === null || typeof t !== 'object' || Array.isArray(t)) return false
    const indexes = (t as { indexes?: unknown }).indexes
    if (indexes === undefined) continue
    if (indexes === null || typeof indexes !== 'object' || Array.isArray(indexes)) return false
  }
  return true
}

export function readLatestSnapshot(metaDir: string): SnapshotShape {
  const files = readdirSync(metaDir)
    .filter((f) => /^\d+_snapshot\.json$/.test(f))
    .sort()
  const latest = files.at(-1)
  if (!latest) throw new Error(`no snapshot found in ${metaDir}`)
  const parsed: unknown = JSON.parse(readFileSync(join(metaDir, latest), 'utf8'))
  if (!isSnapshotShape(parsed)) {
    throw new Error(`snapshot shape invalid in ${latest}`)
  }
  return parsed
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
