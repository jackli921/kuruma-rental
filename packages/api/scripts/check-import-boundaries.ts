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

/**
 * Routes→repositories carve-out registry (#692). One sanctioned tier remains:
 *
 * Sanctioned thin-read routes hold no DOMAIN policy, so a pass-through service would be
 * an anemic layer (transport-level auth like stats' API-key gate is a route concern and
 * stays put). A PERMANENT, documented exception — but narrowed to their *Repository
 * interface only (see importsOnlyRepositoryInterfaces): an entity/filter import is
 * query-shaping that belongs in a service and stays blocked, so the sanction can't become
 * a back door for a thin route to grow fat. A sanctioned route that later grows domain
 * logic (authz scoping, response shaping, orchestration) must graduate to a service — the
 * path vehicles took to VehicleService (#819) — not widen its carve-out. Every other route
 * is fully enforced: no imports from repositories/ at all. See AGENTS.md "API Layer
 * Architecture".
 */
const SANCTIONED_THIN_READ_ROUTES = new Set(['routes/regions.ts', 'routes/stats.ts'])

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

/**
 * True if a collapsed `import ... from '../repositories/types'` line pulls in
 * nothing but `*Repository` interface symbols. Keeps the sanctioned thin-read
 * carve-out (#692) tight: a route may DI its repository contract but not
 * entity/filter types, which signal query-shaping that belongs in a service.
 */
function importsOnlyRepositoryInterfaces(importLine: string): boolean {
  const inner = importLine.match(/\{([^}]*)\}/)?.[1]
  if (inner === undefined) return false
  const symbols = inner
    .split(',')
    .map((s) =>
      s
        .trim()
        .replace(/^type\s+/, '')
        .replace(/\s+as\s+\w+$/, ''),
    )
    .filter(Boolean)
  return symbols.length > 0 && symbols.every((s) => s.endsWith('Repository'))
}

export function checkContent(rel: string, content: string): Violation[] {
  const violations: Violation[] = []

  // Test files are not part of the production dependency graph. They
  // legitimately construct concrete repositories to exercise the DI wiring
  // (a service test injects InMemory doubles by design). The layer-boundary
  // rules govern production code only, so co-located *.test.ts are exempt.
  if (rel.endsWith('.test.ts') || rel.endsWith('.spec.ts')) return violations

  // Collapse formatter-wrapped imports onto their opening line so the per-line
  // import rules below can't be bypassed by a multi-symbol import split across
  // lines — biome wraps exactly those (e.g. `import {\n  X,\n} from '...'`).
  // Continuation lines are blanked to keep 1-based line numbers stable for
  // violation reporting.
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i]!
    if (!/^\s*import\b/.test(open) || /\bfrom\s+['"]/.test(open) || !open.includes('{')) continue
    let joined = open
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j]!
      joined += ` ${cont.trim()}`
      lines[j] = ''
      if (/\bfrom\s+['"]/.test(cont)) break
    }
    lines[i] = joined.replace(/\s+/g, ' ')
  }

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
  // Routes→repositories carve-out (#692): the lone sanctioned thin-read tier.
  // Rationale and the route set live at SANCTIONED_THIN_READ_ROUTES (top).
  const isSanctionedThinReadRoute = SANCTIONED_THIN_READ_ROUTES.has(rel)

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
    // service layer (routes -> services -> repositories). One scoped carve-out
    // exists (#692): sanctioned thin reads may DI only their *Repository
    // interface.
    if (isRoute && /from\s+['"]\.\.\/repositories\//.test(trimmed)) {
      if (/from\s+['"]\.\.\/repositories\/(?!types)/.test(trimmed)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: trimmed,
          rule: 'Routes must not import concrete repositories.',
        })
      } else if (isSanctionedThinReadRoute) {
        // regions/stats may DI only their *Repository interface (#692); an
        // entity/filter import is query-shaping that belongs in a service.
        if (!importsOnlyRepositoryInterfaces(trimmed)) {
          violations.push({
            file: rel,
            line: i + 1,
            text: trimmed,
            rule: 'Sanctioned thin-read routes (regions/stats) may import only their *Repository interface from repositories/types; an entity/filter type signals logic that belongs in a service.',
          })
        }
      } else {
        violations.push({
          file: rel,
          line: i + 1,
          text: trimmed,
          rule: 'Routes must not import from repositories/types; source filter/entity types from the service layer. (Only thin-read routes regions/stats may DI their *Repository interface.)',
        })
      }
    }

    // Rule 1b (#1213): Routes must not import persistence entity types from the
    // `../stores` barrel. stores.ts is the types-only data-layer contract; a route
    // receives an already-projected DTO from its service, so an entity import is a
    // toView/cast leak that belongs in the service (the #1164 payment-anomalies fix,
    // now enforced rather than manual). Services/repositories may still use it.
    if (isRoute && /from\s+['"]\.\.\/stores['"]/.test(trimmed)) {
      violations.push({
        file: rel,
        line: i + 1,
        text: trimmed,
        rule: 'Routes must not import persistence entity types from ../stores; receive a projected type from the service layer instead.',
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
