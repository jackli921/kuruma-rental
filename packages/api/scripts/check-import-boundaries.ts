/**
 * Enforces the MVC + DI layer architecture for packages/api.
 *
 * Import direction: routes → services → repositories. Never backwards.
 * Only index.ts (composition root) may import concrete repository classes.
 *
 * Run: bun run packages/api/scripts/check-import-boundaries.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const API_SRC = join(import.meta.dirname, '..', 'src')

interface Violation {
  file: string
  line: number
  text: string
  rule: string
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full))
    } else if (entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = []
  const rel = relative(API_SRC, filePath)
  const lines = readFileSync(filePath, 'utf-8').split('\n')

  const isRoute = rel.startsWith('routes/')
  const isService = rel.startsWith('services/')
  const isCompositionRoot = rel === 'index.ts'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    // Skip non-import lines
    if (!trimmed.startsWith('import ') && !trimmed.startsWith('import{')) continue

    // Rule 1: Routes must not import concrete repositories.
    // Type-only imports from repositories/types are allowed (interfaces for DI).
    // Concrete imports (drizzle, in-memory) are never allowed in routes.
    if (isRoute && /from\s+['"]\.\.\/repositories\/(?!types)/.test(trimmed)) {
      violations.push({
        file: rel,
        line: i + 1,
        text: trimmed,
        rule: 'Routes must not import concrete repositories. Only type imports from repositories/types are allowed.',
      })
    }

    // Rule 2: Services must not import concrete repository classes
    if (isService) {
      if (/from\s+['"]\.\.\/repositories\/(?!types)/.test(trimmed)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: trimmed,
          rule: 'Services must only import repository interfaces from types.ts, not concrete implementations.',
        })
      }
    }

    // Rule 3: Only index.ts may import concrete repos (drizzle, in-memory)
    if (!isCompositionRoot) {
      if (/from\s+['"]\.\/repositories\/(drizzle|in-memory)/.test(trimmed)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: trimmed,
          rule: 'Only index.ts (composition root) may import concrete repository implementations.',
        })
      }
      if (/from\s+['"]\.\.\/repositories\/(drizzle|in-memory(?!-))/.test(trimmed)) {
        // Allow in-memory-vehicle-detail etc. from index only
        if (!isCompositionRoot) {
          violations.push({
            file: rel,
            line: i + 1,
            text: trimmed,
            rule: 'Only index.ts (composition root) may import concrete repository implementations.',
          })
        }
      }
    }
  }

  return violations
}

const files = collectTsFiles(API_SRC)
const allViolations = files.flatMap(checkFile)

if (allViolations.length > 0) {
  console.error('\nImport boundary violations found:\n')
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    ${v.text}`)
    console.error(`    Rule: ${v.rule}\n`)
  }
  process.exit(1)
} else {
  console.log('Import boundaries OK')
}
