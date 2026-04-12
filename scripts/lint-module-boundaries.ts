#!/usr/bin/env bun
import { readFileSync } from 'node:fs'

export type Violation = {
  file: string
  importPath: string
  reason: 'cross-module-internal'
}

// Matches: import ... from '<spec>'  and  import '<spec>'  and  export ... from '<spec>'
const IMPORT_RE = /(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g

// Alias import reaching into module internals: @/modules/<name>/<sub>
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
