#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { Glob } from 'bun'

export type Violation = {
  file: string
  importPath: string
  reason: 'cross-module-internal' | 'web-runtime-db'
}

type ImportRef = { spec: string; typeOnly: boolean }

// Matches `import ... from '<spec>'` and `export ... from '<spec>'`, capturing a
// leading `type` modifier (group 1) so `import type {...}` / `export type {...}`
// are told apart from runtime imports. The negated class spans newlines, so
// multi-line imports are handled. Inline `import { type X }` is treated as
// runtime (conservative); biome's useImportType keeps that form rare.
const IMPORT_RE = /(?:import|export)\s+(type\s+)?[^'"`]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g

// Alias import reaching into module internals: @/modules/<name>/<sub>
// Known limitation: relative imports (e.g. '../../vehicles/api') bypass this
// check. The codebase convention is @/ aliases, and Biome's import sorting
// enforces it, so the risk is low. If relative cross-module imports become a
// real problem, upgrade to an AST-based check or add a relative-path resolver.
const INTERNAL_ALIAS_RE = /^@\/modules\/([^/]+)\/(.+)$/

// #722: packages/web has NO direct DB access — all data flows through the Hono
// API (CLAUDE.md architecture boundary). A runtime import of the web DB client
// or Drizzle anywhere under packages/web/src is forbidden, EXCEPT the two
// sanctioned Auth.js files below, which need the Drizzle adapter at runtime.
// `import type` is always allowed (erased at build, so it creates no DB path).
const WEB_SRC_MARKER = 'packages/web/src/'
const WEB_DB_CARVE_OUT = new Set(['auth.ts', 'lib/db.ts'])
const FORBIDDEN_WEB_DB_PREFIXES = ['@/lib/db', '@kuruma/shared/db', 'drizzle-orm']

function collectImports(source: string): ImportRef[] {
  const refs: ImportRef[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    refs.push({ spec: match[2]!, typeOnly: Boolean(match[1]) })
  }
  for (const match of source.matchAll(BARE_IMPORT_RE)) {
    refs.push({ spec: match[1]!, typeOnly: false })
  }
  return refs
}

function moduleOfFile(file: string): string | null {
  const p = file.replaceAll('\\', '/')
  const match = p.match(/\/modules\/([^/]+)\//)
  return match ? match[1]! : null
}

// The path under packages/web/src (e.g. 'auth.ts', 'vite/bookings/api.ts'), or
// null if the file is outside the web package. Substring-based so it resolves
// real files and test fixtures alike.
function webRelPath(file: string): string | null {
  const p = file.replaceAll('\\', '/')
  const i = p.indexOf(WEB_SRC_MARKER)
  return i === -1 ? null : p.slice(i + WEB_SRC_MARKER.length)
}

function isForbiddenWebDbSpec(spec: string): boolean {
  return FORBIDDEN_WEB_DB_PREFIXES.some((p) => spec === p || spec.startsWith(`${p}/`))
}

export function checkImports(files: string[]): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      // Unreadable files are the file-size script's concern; skip here.
      continue
    }
    const importingModule = moduleOfFile(file)
    const webRel = webRelPath(file)
    const webDbExempt = webRel !== null && WEB_DB_CARVE_OUT.has(webRel)
    for (const { spec, typeOnly } of collectImports(source)) {
      // Rule 1: no cross-module reach into another module's internals.
      const internal = spec.match(INTERNAL_ALIAS_RE)
      if (internal && importingModule !== internal[1]!) {
        violations.push({ file, importPath: spec, reason: 'cross-module-internal' })
      }
      // Rule 2 (#722): no runtime DB import from the web package (Auth.js aside).
      if (webRel !== null && !webDbExempt && !typeOnly && isForbiddenWebDbSpec(spec)) {
        violations.push({ file, importPath: spec, reason: 'web-runtime-db' })
      }
    }
  }
  return violations
}

const ROOTS = ['packages/api/src', 'packages/web/src', 'packages/shared/src']
const INCLUDE_PATTERN = '**/*.{ts,tsx}'
const EXCLUDE_PATTERNS = [
  /\.test\.tsx?$/,
  /\/tests\//,
  /\/__fixtures__\//,
  /\/node_modules\//,
  /\/\.next\//,
  /\/\.open-next\//,
  /\/\.wrangler\//,
  /\/dist\//,
  /\/drizzle\//,
]

function discover(): string[] {
  const out: string[] = []
  const glob = new Glob(INCLUDE_PATTERN)
  for (const root of ROOTS) {
    for (const rel of glob.scanSync({ cwd: root, onlyFiles: true })) {
      const full = `${root}/${rel}`
      if (EXCLUDE_PATTERNS.some((r) => r.test(full))) continue
      out.push(full)
    }
  }
  return out
}

function describeViolation(v: Violation): string {
  if (v.reason === 'web-runtime-db') {
    return `runtime DB import "${v.importPath}" — packages/web has no direct DB access; route through the Hono API. Use 'import type' for types; only auth.ts/lib/db.ts may touch the DB at runtime (Auth.js).`
  }
  return `imports "${v.importPath}" — cross-module internal import; use the '@/modules/<name>' barrel instead.`
}

function main(): number {
  const files = discover()
  const violations = checkImports(files)
  for (const v of violations) {
    process.stderr.write(`[lint-module-boundaries] ERROR ${v.file}: ${describeViolation(v)}\n`)
  }
  if (violations.length > 0) {
    process.stderr.write(`[lint-module-boundaries] ${violations.length} violation(s).\n`)
    return 1
  }
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
