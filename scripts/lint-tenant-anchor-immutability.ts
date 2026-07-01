// ENFORCES: every operator-scoped repo keeps operatorId immutable on update() —
// the Drizzle repo strips it out of .set(), the in-memory repo pins it to the
// existing row. Stops the next operator-scoped repo shipping unsealed (#1289).
// SSOT: docs/architecture/modules.md § packages/api repositories
/**
 * Enforce: operatorId is an immutable tenant anchor on every operator-scoped repo.
 *
 * operatorId is the tenant boundary. If an update() lets a caller-supplied payload
 * overwrite it, a row can be silently migrated to another operator — a cross-tenant
 * IDOR write. Six repos hand-rolled the seal (vehicle, fee-schedule, add-on,
 * insurance-option, location, vehicle-class, via #386/#1271/#1279/#1288). The risk
 * is NOT the duplication; it is that repo #7 ships WITHOUT the seal, exactly as
 * location/vehicle-class did until #1279. A base class fights the function-injection
 * DI style, and a shared helper is as forgettable as the destructure. So we guard it,
 * like scripts/lint-fk-indexes.ts and check-import-boundaries.ts do for their invariants.
 *
 * How we check (fail-closed on anything we cannot prove safe):
 *  - Introspect schema.ts at runtime for the tables carrying a NON-NULL operatorId
 *    column. Their drizzle-export names are the operator-scoped tables.
 *  - A drizzle repo is operator-scoped if it calls `.update(<that export>)`.
 *    - If its `.set(...)` writes operatorId as an explicit key -> violation.
 *    - If its `.set(...)` SPREADS a payload (`...x`) it must also strip operatorId
 *      via a destructure discard (`operatorId: _operatorId`) — else violation.
 *      An explicit-key `.set({ status, ... })` (no spread) is inherently safe.
 *  - The paired in-memory repo (same basename) must PIN operatorId
 *    (`operatorId: existing.operatorId`) whenever its update reconstructs the row by
 *    spreading caller data into `{ ...existing, ...patch }` — else violation.
 *  - EXEMPTIONS carry a documented reason for a spread that is provably safe by type
 *    (e.g. a `Pick<>` DTO that structurally cannot contain operatorId).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'

export type RepoLayer = 'drizzle' | 'in-memory'

export interface RepoFile {
  path: string
  layer: RepoLayer
  basename: string
  source: string
}

export type ViolationKind =
  | 'drizzle-writes-operatorId' // .set() writes operatorId as an explicit key
  | 'drizzle-spread-unsealed' // .set() spreads a payload without stripping operatorId
  | 'in-memory-unpinned' // reconstructs by spreading caller data without pinning operatorId

export interface Violation {
  path: string
  basename: string
  kind: ViolationKind
}

/**
 * Exempt basenames: a spread that is provably safe by type, so the seal/pin is not
 * required. Each MUST carry a reason — an exemption is a conscious decision, not a
 * silent skip.
 */
export const EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  [
    'review',
    'ReviewEdit = Pick<Review, "overall" | "subRatings" | "comment"> — structurally cannot carry operatorId, so `.set({ ...patch })` / `{ ...existing, ...patch }` is safe.',
  ],
])

const UPDATE_CALL_RE = /\.update\(\s*(\w+)\s*\)/g
const DRIZZLE_SEAL_RE = /operatorId:\s*_\w+/
const IN_MEMORY_PIN_RE = /operatorId:\s*(?:existing|current)\.operatorId\b/
const OPERATOR_ID_KEY_RE = /\boperatorId\s*[:,]/

// Export names of the drizzle tables a repo file calls `.update(<export>)` on.
export function updatedTableExports(source: string): string[] {
  return [...source.matchAll(UPDATE_CALL_RE)].map((m) => m[1]).filter((n): n is string => !!n)
}

// The text of each `.set(...)` payload: from `.set(` up to the next chained
// terminator (`.where(` / `.returning(`), so we never read the WHERE clause (which
// legitimately references operatorId) as part of the written payload.
export function setPayloads(source: string): string[] {
  const payloads: string[] = []
  for (const m of source.matchAll(/\.set\(/g)) {
    const start = m.index + m[0].length
    const rest = source.slice(start)
    // Only a Drizzle inline `.set({ ... })` is a write payload. Skip `Map.set(k, v)`
    // and any `.set(` not opening an object literal.
    if (!/^\s*\{/.test(rest)) continue
    const where = rest.search(/\.where\(/)
    const returning = rest.search(/\.returning\(/)
    const ends = [where, returning].filter((i) => i >= 0)
    const end = ends.length > 0 ? Math.min(...ends) : rest.length
    payloads.push(rest.slice(0, end))
  }
  return payloads
}

export function setSpreadsPayload(source: string): boolean {
  return setPayloads(source).some((p) => p.includes('...'))
}

export function setWritesOperatorId(source: string): boolean {
  return setPayloads(source).some((p) => OPERATOR_ID_KEY_RE.test(p))
}

export function hasDrizzleSeal(source: string): boolean {
  return DRIZZLE_SEAL_RE.test(source)
}

// Object literals (single brace depth) that spread `existing`/`current`. The row
// reconstruction in an in-memory update. Nested-brace objects are not matched — the
// six real reconstructions have none; a future nested one is a known blind spot.
function reconstructionObjects(source: string): string[] {
  return [...source.matchAll(/\{[^{}]*\}/gs)]
    .map((m) => m[0])
    .filter((o) => /\.\.\.(?:existing|current)\b/.test(o))
}

// Top-level object-property spreads: `{ ...x, ... }` or `, ...x,`. A bare identifier
// standing as its own property. This deliberately excludes array spreads
// (`photos: [...a, ...b]`) and member spreads (`...existing.photos`) — neither can
// inject an operatorId key at the object's top level.
function topLevelSpreadNames(object: string): string[] {
  // Trailing delimiter is a lookahead so a comma shared by two adjacent spreads
  // (`...existing, ...data`) is not consumed by the first match and can still open
  // the second.
  return [...object.matchAll(/[{,]\s*\.\.\.(\w+)\s*(?=[,}])/g)].map((m) => m[1] as string)
}

// An in-memory update is unpinned if it spreads a CALLER payload (any top-level
// spread other than the existing row) over the existing row without pinning operatorId.
export function inMemoryReconstructsUnpinned(source: string): boolean {
  return reconstructionObjects(source).some((o) => {
    const spreadsCallerData = topLevelSpreadNames(o).some(
      (name) => name !== 'existing' && name !== 'current',
    )
    return spreadsCallerData && !IN_MEMORY_PIN_RE.test(o)
  })
}

export function findViolations(
  files: readonly RepoFile[],
  operatorScopedExports: ReadonlySet<string>,
  exemptions: ReadonlyMap<string, string> = EXEMPTIONS,
): Violation[] {
  const violations: Violation[] = []
  const operatorScopedBasenames = new Set<string>()

  for (const file of files) {
    if (file.layer !== 'drizzle') continue
    const scoped = updatedTableExports(file.source).some((e) => operatorScopedExports.has(e))
    if (!scoped) continue
    operatorScopedBasenames.add(file.basename)
    if (exemptions.has(file.basename)) continue
    if (setWritesOperatorId(file.source)) {
      violations.push({
        path: file.path,
        basename: file.basename,
        kind: 'drizzle-writes-operatorId',
      })
    } else if (setSpreadsPayload(file.source) && !hasDrizzleSeal(file.source)) {
      violations.push({ path: file.path, basename: file.basename, kind: 'drizzle-spread-unsealed' })
    }
  }

  for (const file of files) {
    if (file.layer !== 'in-memory') continue
    if (!operatorScopedBasenames.has(file.basename)) continue
    if (exemptions.has(file.basename)) continue
    if (inMemoryReconstructsUnpinned(file.source)) {
      violations.push({ path: file.path, basename: file.basename, kind: 'in-memory-unpinned' })
    }
  }

  return violations
}

export async function introspectOperatorScopedExports(schemaPath: string): Promise<Set<string>> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import of drizzle schema
  const mod: Record<string, any> = await import(schemaPath)
  const exports = new Set<string>()
  for (const [exportName, value] of Object.entries(mod)) {
    if (!value || typeof value !== 'object' || !('getSQL' in value)) continue
    // biome-ignore lint/suspicious/noExplicitAny: drizzle internals
    const cfg = getTableConfig(value as any)
    for (const col of Object.values(cfg.columns) as { name: string; notNull: boolean }[]) {
      // The schema declares this column in camelCase (`operatorId`); accept the
      // snake_case form too so the check survives a future casing convention.
      if ((col.name === 'operatorId' || col.name === 'operator_id') && col.notNull) {
        exports.add(exportName)
      }
    }
  }
  return exports
}

function readRepoFiles(dir: string, layer: RepoLayer): RepoFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')
    .map((f) => ({
      path: join(dir, f),
      layer,
      basename: f.replace(/\.ts$/, ''),
      source: readFileSync(join(dir, f), 'utf8'),
    }))
}

export async function runLint(opts: {
  schemaPath: string
  drizzleDir: string
  inMemoryDir: string
  exemptions?: ReadonlyMap<string, string>
}): Promise<Violation[]> {
  const operatorScopedExports = await introspectOperatorScopedExports(opts.schemaPath)
  const files = [
    ...readRepoFiles(opts.drizzleDir, 'drizzle'),
    ...readRepoFiles(opts.inMemoryDir, 'in-memory'),
  ]
  return findViolations(files, operatorScopedExports, opts.exemptions ?? EXEMPTIONS)
}

const REASON: Record<ViolationKind, string> = {
  'drizzle-writes-operatorId':
    'writes operatorId as an explicit key in .set() — an operatorId reassignment',
  'drizzle-spread-unsealed':
    'spreads an update payload into .set() without stripping operatorId (add `operatorId: _operatorId` to the destructure)',
  'in-memory-unpinned':
    'reconstructs the row by spreading caller data without pinning `operatorId: existing.operatorId`',
}

async function main() {
  const base = new URL('../packages/', import.meta.url).pathname
  const violations = await runLint({
    schemaPath: join(base, 'shared/src/db/schema.ts'),
    drizzleDir: join(base, 'api/src/repositories/drizzle'),
    inMemoryDir: join(base, 'api/src/repositories/in-memory'),
  })
  if (violations.length > 0) {
    console.error(
      `[lint-tenant-anchor-immutability] ${violations.length} operator-scoped repo(s) leave operatorId mutable:`,
    )
    for (const v of violations) console.error(`  - ${v.path}: ${REASON[v.kind]}`)
    console.error(
      '\noperatorId is an immutable tenant anchor. Strip it in the Drizzle update()\n' +
        'and pin it in the in-memory update(), mirroring drizzle/vehicle.ts. If a spread\n' +
        'is provably safe by type, add it to EXEMPTIONS with a reason.',
    )
    process.exit(1)
  }
  console.log(
    '[lint-tenant-anchor-immutability] all operator-scoped repos keep operatorId immutable',
  )
}

if (import.meta.main) {
  void main()
}
