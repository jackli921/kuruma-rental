#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { Glob } from 'bun'

export type Violation = {
  file: string
  importPath: string
  reason: 'cross-module-internal'
}

// Matches: import ... from '<spec>'  and  import '<spec>'  and  export ... from '<spec>'
const IMPORT_RE = /(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g

// Alias import reaching into module internals: @/modules/<name>/<sub>
// Known limitation: relative imports (e.g. '../../vehicles/api') bypass this
// check. The codebase convention is @/ aliases, and Biome's import sorting
// enforces it, so the risk is low. If relative cross-module imports become a
// real problem, upgrade to an AST-based check or add a relative-path resolver.
const INTERNAL_ALIAS_RE = /^@\/modules\/([^/]+)\/(.+)$/

function collectImports(source: string): string[] {
  const specs: string[] = []
  for (const match of source.matchAll(IMPORT_RE)) specs.push(match[1]!)
  for (const match of source.matchAll(BARE_IMPORT_RE)) specs.push(match[1]!)
  return specs
}

function moduleOfFile(file: string): string | null {
  const p = file.replaceAll('\\', '/')
  const match = p.match(/\/modules\/([^/]+)\//)
  return match ? match[1]! : null
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
    for (const spec of collectImports(source)) {
      const m = spec.match(INTERNAL_ALIAS_RE)
      if (!m) continue
      const targetModule = m[1]!
      // Allow files inside the same module to reference their own internals
      // (though relative imports are preferred). This check is cross-module only.
      if (importingModule === targetModule) continue
      violations.push({ file, importPath: spec, reason: 'cross-module-internal' })
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

function main(): number {
  const files = discover()
  const violations = checkImports(files)
  for (const v of violations) {
    process.stderr.write(
      `[lint-module-boundaries] ERROR ${v.file}: imports "${v.importPath}" (cross-module internal import)\n`,
    )
  }
  if (violations.length > 0) {
    process.stderr.write(
      `[lint-module-boundaries] ${violations.length} violation(s). Import from '@/modules/<name>' (the barrel) instead.\n`,
    )
    return 1
  }
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
