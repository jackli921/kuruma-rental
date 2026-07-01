// ENFORCES: every FK column in the drizzle schema has a covering index (unindexed FK = seq scan, outage-grade at scale)
// SSOT: docs/architecture/modules.md § packages/shared
/**
 * Enforce: every FK column in the drizzle schema must have a covering index.
 *
 * Postgres does NOT auto-create indexes on FK columns. An unindexed FK turns
 * every JOIN or WHERE-by-fk into a sequential scan. Invisible at 50 rows;
 * outage-grade at 50k. Same pattern as issue #88 and #254.
 *
 * How we check:
 *  - Introspect schema.ts at runtime via drizzle-orm's getTableConfig.
 *    This gives authoritative FK columns per table.
 *  - Parse every drizzle/*.sql migration for CREATE [UNIQUE] INDEX and
 *    DROP INDEX, then fold them in migration order — a dropped index stops
 *    counting as cover, so the check reflects the index set that SURVIVES
 *    (not every index ever created). Indexes declared in schema.ts via
 *    `.index()` are caught because drizzle-kit emits them as CREATE INDEX.
 *  - A FK is "indexed" if the column is a primary key OR the leading column
 *    of any index. Trailing columns of a composite index don't count —
 *    matches Postgres's actual query-planning behavior.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'

export interface ForeignKey {
  table: string
  column: string
}

export interface PrimaryKeyColumn {
  table: string
  column: string
}

export interface IndexedColumns {
  table: string
  columns: string[]
}

// An ordered index mutation parsed from a migration. `create` records the index
// name so a later `drop` (by the same name) can retract it — this is what makes
// the linter DROP-aware. `DROP CONSTRAINT` is intentionally NOT an event: the
// implicit index a UNIQUE/ADD CONSTRAINT creates was never tracked (we only read
// CREATE INDEX), so dropping the constraint can't retract anything we counted.
export type MigrationEvent =
  | { kind: 'create'; name: string; table: string; columns: string[] }
  | { kind: 'drop'; name: string }

const CREATE_INDEX_RE =
  /create\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+(?:"([^"]+)"|(\w+))\s+on\s+(?:"([^"]+)"|(\w+))\s*(?:using\s+\w+\s*)?\(([^)]+)\)/gi
const DROP_INDEX_RE = /drop\s+index(?:\s+concurrently)?(?:\s+if\s+exists)?\s+(?:"([^"]+)"|(\w+))/gi

// Parse a migration's CREATE INDEX / DROP INDEX statements into source-ordered
// events. Order matters: a migration may drop then re-create the same name
// (#1225), and cross-file order is preserved by the caller iterating sorted files.
export function parseMigrationEvents(sql: string): MigrationEvent[] {
  // Strip line comments so "-- CREATE INDEX ..." doesn't count.
  const cleaned = sql.replace(/--[^\n]*/g, '')
  const at: Array<{ offset: number; event: MigrationEvent }> = []
  for (const m of cleaned.matchAll(CREATE_INDEX_RE)) {
    const name = m[1] ?? m[2]
    const table = m[3] ?? m[4]
    if (!name || !table) continue
    const columns = (m[5] ?? '')
      .split(',')
      .map((c) => c.trim().replace(/^"|"$/g, ''))
      .filter((c) => c.length > 0)
    if (columns.length > 0)
      at.push({ offset: m.index, event: { kind: 'create', name, table, columns } })
  }
  for (const m of cleaned.matchAll(DROP_INDEX_RE)) {
    const name = m[1] ?? m[2]
    if (name) at.push({ offset: m.index, event: { kind: 'drop', name } })
  }
  return at.sort((a, b) => a.offset - b.offset).map((e) => e.event)
}

// Fold ordered events into the set of indexes that still exist, keyed by their
// (globally-unique) name — a create sets, a drop deletes. A drop of a name we
// never created (e.g. a constraint-backed index, or IF EXISTS on nothing) no-ops.
export function foldIndexEvents(events: MigrationEvent[]): IndexedColumns[] {
  const byName = new Map<string, IndexedColumns>()
  for (const ev of events) {
    if (ev.kind === 'create') byName.set(ev.name, { table: ev.table, columns: ev.columns })
    else byName.delete(ev.name)
  }
  return [...byName.values()]
}

export function parseMigrationIndexes(sql: string): IndexedColumns[] {
  return parseMigrationEvents(sql)
    .filter((e): e is Extract<MigrationEvent, { kind: 'create' }> => e.kind === 'create')
    .map(({ table, columns }) => ({ table, columns }))
}

export function findUnindexedFks(
  fks: ForeignKey[],
  pks: PrimaryKeyColumn[],
  indexed: IndexedColumns[],
  exemptions: ReadonlySet<string> = new Set(),
): ForeignKey[] {
  const pkSet = new Set(pks.map((p) => `${p.table}.${p.column}`))
  const idxLeading = new Set(
    indexed
      .map((i) => (i.columns[0] ? `${i.table}.${i.columns[0]}` : null))
      .filter((s): s is string => s !== null),
  )
  return fks.filter((fk) => {
    const key = `${fk.table}.${fk.column}`
    if (exemptions.has(key)) return false
    if (pkSet.has(key)) return false
    if (idxLeading.has(key)) return false
    return true
  })
}

export async function introspectSchemaFks(schemaPath: string): Promise<{
  fks: ForeignKey[]
  pks: PrimaryKeyColumn[]
}> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import of drizzle schema
  const mod: Record<string, any> = await import(schemaPath)
  const fks: ForeignKey[] = []
  const pks: PrimaryKeyColumn[] = []
  for (const value of Object.values(mod)) {
    if (!value || typeof value !== 'object' || !('getSQL' in value)) continue
    // biome-ignore lint/suspicious/noExplicitAny: drizzle internals
    const cfg = getTableConfig(value as any)
    for (const fk of cfg.foreignKeys) {
      // biome-ignore lint/suspicious/noExplicitAny: drizzle reference shape
      const ref = (fk as any).reference() as { columns: { name: string }[] }
      for (const col of ref.columns) fks.push({ table: cfg.name, column: col.name })
    }
    for (const col of Object.values(cfg.columns)) {
      if ((col as { primary?: boolean }).primary) {
        pks.push({ table: cfg.name, column: (col as { name: string }).name })
      }
    }
    for (const pk of cfg.primaryKeys) {
      for (const col of (pk as { columns: { name: string }[] }).columns) {
        pks.push({ table: cfg.name, column: col.name })
      }
    }
  }
  return { fks, pks }
}

export function readMigrationIndexes(drizzleDir: string): IndexedColumns[] {
  const entries = readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  // Fold create/drop events in migration order so a dropped index stops counting
  // as FK cover — the linter checks the index set that actually SURVIVES.
  const events = entries.flatMap((f) =>
    parseMigrationEvents(readFileSync(join(drizzleDir, f), 'utf8')),
  )
  return foldIndexEvents(events)
}

export async function runLint(opts: {
  schemaPath: string
  drizzleDir: string
  exemptions?: ReadonlySet<string>
}): Promise<{ missing: ForeignKey[]; totalFks: number }> {
  const { fks, pks } = await introspectSchemaFks(opts.schemaPath)
  const indexed = readMigrationIndexes(opts.drizzleDir)
  const missing = findUnindexedFks(fks, pks, indexed, opts.exemptions ?? new Set())
  return { missing, totalFks: fks.length }
}

async function main() {
  const schemaPath = new URL('../packages/shared/src/db/schema.ts', import.meta.url).pathname
  const drizzleDir = new URL('../drizzle', import.meta.url).pathname
  const { missing, totalFks } = await runLint({ schemaPath, drizzleDir })
  if (missing.length > 0) {
    console.error(`[lint-fk-indexes] ${missing.length} of ${totalFks} FKs lack an index:`)
    for (const fk of missing) console.error(`  - ${fk.table}.${fk.column}`)
    console.error(
      '\nAdd `.index(...).on(table.col)` to schema.ts and run `bun run db:generate`,\n' +
        'or CREATE INDEX in a custom migration. Primary-key columns are considered indexed.',
    )
    process.exit(1)
  }
  console.log(`[lint-fk-indexes] all ${totalFks} FKs are indexed`)
}

if (import.meta.main) {
  void main()
}
