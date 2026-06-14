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

export function checkContent(rel: string, content: string): Violation[] {
  const violations: Violation[] = []

  // Test files are not part of the production dependency graph. They
  // legitimately construct concrete repositories to exercise the DI wiring
  // (a service test injects InMemory doubles by design). The layer-boundary
  // rules govern production code only, so co-located *.test.ts are exempt.
  if (rel.endsWith('.test.ts') || rel.endsWith('.spec.ts')) return violations

  const lines = content.split('\n')

  const isRoute = rel.startsWith('routes/')
  const isService = rel.startsWith('services/')
  // The composition root is index.ts plus the composition/ bundle it delegates
  // repository construction to (#693). Both legitimately import concrete repos;
  // nothing else may. Keep these the only entries allowed to wire concretes.
  const isCompositionRoot = rel === 'index.ts' || rel.startsWith('composition/')
  const isHelpers = rel === 'routes/helpers.ts'
  // The two transaction factories are the one sanctioned place outside the
  // composition root to construct concrete repos. They must rebind every repo to
  // the per-call neon-serverless tx connection (#493), which index.ts cannot do
  // per call. Everything else under repositories/drizzle stays construction-free (#721).
  const isTxFactory =
    rel === 'repositories/drizzle/transaction.ts' ||
    rel === 'repositories/drizzle/operator-grant-transaction.ts'
  // DI-repo carve-out: these routes DI a repository as their constructor contract
  // and have no service layer yet, so they may import that *Repository interface
  // from repositories/types until their own service extraction lands (#726).
  // Every other route must source filter/entity types from the service layer.
  const isDiRepoCarveoutRoute =
    rel === 'routes/regions.ts' || rel === 'routes/stats.ts' || rel === 'routes/vehicles.ts'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    // Rule 4: Routes must parse request bodies via parseBody(c, schema) from
    // helpers.ts, not via direct c.req.json() + ad-hoc safeParse. Keeps error-
    // envelope shape consistent across the API. helpers.ts itself is the one
    // legitimate caller of c.req.json().
    if (isRoute && !isHelpers && /\bc\.req\.json\s*\(/.test(trimmed)) {
      violations.push({
        file: rel,
        line: i + 1,
        text: trimmed,
        rule: 'Routes must use parseBody(c, schema) from helpers.ts instead of calling c.req.json() directly.',
      })
    }

    // Rule 5: Concrete repositories may only be `new`ed in the composition root
    // (index.ts / composition/) or the two sanctioned transaction factories. The
    // import-path rules below never see construction, so a sibling file under
    // repositories/drizzle could `new DrizzleXRepository()` and slip the net (#721).
    if (
      !isCompositionRoot &&
      !isTxFactory &&
      /\bnew\s+(?:Drizzle|InMemory)\w*\s*\(/.test(trimmed)
    ) {
      violations.push({
        file: rel,
        line: i + 1,
        text: trimmed,
        rule: 'Concrete repositories may only be constructed in the composition root (index.ts / composition/) or the sanctioned transaction factories (repositories/drizzle/*-transaction.ts).',
      })
    }

    // Skip non-import lines for the remaining rules
    if (!trimmed.startsWith('import ') && !trimmed.startsWith('import{')) continue

    // Rule 1: Routes must not import from repositories/ — neither concrete
    // implementations nor type contracts. Filter/entity types come from the
    // service layer (routes -> services -> repositories). The DI-repo carve-out
    // routes are the one documented exception, and only for their *Repository
    // interface type, never a concrete (#726).
    if (isRoute && /from\s+['"]\.\.\/repositories\//.test(trimmed)) {
      if (/from\s+['"]\.\.\/repositories\/(?!types)/.test(trimmed)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: trimmed,
          rule: 'Routes must not import concrete repositories.',
        })
      } else if (!isDiRepoCarveoutRoute) {
        violations.push({
          file: rel,
          line: i + 1,
          text: trimmed,
          rule: 'Routes must not import from repositories/types; source filter/entity types from the service layer. DI-repo carve-out (regions/stats/vehicles) may import their *Repository contract until service extraction lands.',
        })
      }
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

function checkFile(filePath: string): Violation[] {
  return checkContent(relative(API_SRC, filePath), readFileSync(filePath, 'utf-8'))
}

// Only scan the tree when run as a script. Importing this module (e.g. from a
// unit test that exercises checkContent) must not trigger the scan or exit.
if (import.meta.main) {
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
}
