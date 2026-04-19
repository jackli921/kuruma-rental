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
 *    collect (table, leading-column) pairs. Indexes declared in schema.ts
 *    via `.index()` are also caught because drizzle-kit emits them as
 *    CREATE INDEX in the generated SQL.
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

export function parseMigrationIndexes(sql: string): IndexedColumns[] {
  // Strip line comments so "-- CREATE INDEX ..." doesn't count.
  const cleaned = sql.replace(/--[^\n]*/g, '')
  const re =
    /create\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+(?:"[^"]+"|\w+)\s+on\s+(?:"([^"]+)"|(\w+))\s*(?:using\s+\w+\s*)?\(([^)]+)\)/gi
  const out: IndexedColumns[] = []
  for (const m of cleaned.matchAll(re)) {
    const table = m[1] ?? m[2]
    if (!table) continue
    const columns = (m[3] ?? '')
      .split(',')
      .map((c) => c.trim().replace(/^"|"$/g, ''))
      .filter((c) => c.length > 0)
    if (columns.length > 0) out.push({ table, columns })
  }
  return out
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
  const all: IndexedColumns[] = []
  for (const f of entries) {
    all.push(...parseMigrationIndexes(readFileSync(join(drizzleDir, f), 'utf8')))
  }
  return all
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
