#!/usr/bin/env bun
// ENFORCES: web feature code imports only via the `@/modules/<feature>` barrel (no cross-module internals); web has no direct DB access
// SSOT: docs/architecture/modules.md § Enforcement
import { readFileSync, writeFileSync } from 'node:fs'
import { Glob } from 'bun'

export type Violation = {
  file: string
  importPath: string
  reason: 'cross-module-internal' | 'web-runtime-db' | 'vite-cross-feature'
}

type ImportRef = { spec: string; typeOnly: boolean }

// Matches `import ... from '<spec>'` and `export ... from '<spec>'`, capturing a
// leading `type` modifier (group 1) so `import type {...}` / `export type {...}`
// are told apart from runtime imports. The negated class spans newlines, so
// multi-line imports are handled. Inline `import { type X }` is treated as
// runtime (conservative); biome's useImportType keeps that form rare.
const IMPORT_RE = /(?:import|export)\s+(type\s+)?[^'"`]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g

// Alias import reaching into module internals: @/modules/<name>/<sub>.
// Today src/modules/ is empty (#1110: web lives in src/vite/), so this rule is
// a no-op tripwire kept for when feature-drain PRs start migrating code into
// the documented modules/ tree (see docs/architecture/modules.md).
// Known limitation: relative imports (e.g. '../../vehicles/api') bypass this
// check. The codebase convention is @/ aliases, and Biome's import sorting
// enforces it, so the risk is low. If relative cross-module imports become a
// real problem, upgrade to an AST-based check or add a relative-path resolver.
const INTERNAL_ALIAS_RE = /^@\/modules\/([^/]+)\/(.+)$/

// #1110: web feature boundary enforced against the directory we actually use
// today (`packages/web/src/vite/<feature>/`), not the empty `@/modules/`.
// Matches `@/vite/<feature>/<sub>` — a deep import. A bare `@/vite/<feature>`
// (the per-feature barrel) is allowed by intent and not captured here.
const VITE_FEATURE_DEEP_RE = /^@\/vite\/([^/]+)\/(.+)$/

// #722: packages/web has NO direct DB access — all data flows through the Hono
// API (CLAUDE.md architecture boundary). A runtime import of the web DB client
// or Drizzle anywhere under packages/web/src is forbidden. `import type` is
// always allowed (erased at build, so it creates no DB path).
// #714: the Auth.js carve-out (auth.ts, lib/db.ts) was removed — web no longer
// runs Auth.js, so the rule is now unconditional.
const WEB_SRC_MARKER = 'packages/web/src/'
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

// The web vite feature the file lives in (e.g. 'bookings' for
// `packages/web/src/vite/bookings/list.tsx`), or null when the file is not
// inside any `vite/<feature>/` subtree (loose `vite/foo.ts`, routes/, etc.).
export function viteFeatureOfWebFile(webRel: string | null): string | null {
  if (webRel === null) return null
  const m = webRel.match(/^vite\/([^/]+)\//)
  return m ? m[1]! : null
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

// #719: src/modules/<feature>/ is the canonical web feature home (see
// docs/architecture/modules.md). src/vite/ is a time-boxed migration staging
// tree to be drained per-feature; src/components/<feature>/ is grandfathered
// (only src/components/ui/ design-system primitives are sanctioned). This is a
// NON-FAILING ratchet: it warns only when the count of migratable files under
// the deprecated roots grows past the baseline, so the swarm still working in
// src/vite/ today is not blocked. The count mirrors the failing-rule scan
// (tests and fixtures excluded) and skips ambient .d.ts stubs.
//
// Known gap (accepted): being count-based, a same-PR delete+add nets zero and
// slips past this. That is fine — this is a soft tripwire, not a gate; the
// binding rule is the doc's "no new features in src/vite/". Upgrade to a path
// manifest only if net-zero regressions actually happen in practice.
//
// After a drain, refresh in place with:
//   bun run scripts/lint-module-boundaries.ts --update-baseline
const DEPRECATED_WEB_TREE_BASELINE = 170

// #1110: cross-feature reach-ins into vite/<feature>/<internal> from outside
// that feature. Counted globally; the rule is a ratchet (monotonic
// non-increasing). A new reach-in pushes the count above this baseline and
// fails CI; draining one shrinks the count and triggers a soft notice to lock
// in the new baseline. Refresh with --update-baseline (same flag as the tree
// ratchet above).
// 163 (#1489): routes/$locale.tsx composes the RouteAnnouncer feature component, the same
// sanctioned routes-compose-a-vite-feature pattern as its sibling Navbar/AdminSidebar imports.
// 165 (#877 operator terms): routes/$locale/_business/manage/terms.tsx composes the
// operator-terms feature view + api (two reach-ins) — the same sanctioned
// routes-compose-a-vite-feature pattern as the siblings above.
// 169 (#464 combo deals): routes/$locale/_business/manage/combo-deals.tsx composes the
// operator-combo-deals feature view + api AND the operator-classes/api +
// operator-locations/api query options for the class/location pickers (four
// reach-ins) — the same sanctioned routes-compose-a-vite-feature pattern.
const VITE_CROSS_FEATURE_REACH_IN_BASELINE = 169

export type DeprecatedTreeStatus = {
  count: number
  baseline: number
  level: 'ok' | 'grew' | 'shrank'
}

// A web file under a deprecated root: anything in vite/, or a feature subdir of
// components/ other than the sanctioned ui/ primitives. `webRel` is the path
// under packages/web/src, or null for non-web files.
export function isDeprecatedWebFile(webRel: string | null): boolean {
  if (webRel === null) return false
  // Ambient type stubs (e.g. vite-env.d.ts) are not migratable feature code.
  if (webRel.endsWith('.d.ts')) return false
  if (webRel.startsWith('vite/')) return true
  const feature = webRel.match(/^components\/([^/]+)\//)
  return feature !== null && feature[1] !== 'ui'
}

export function countDeprecatedWebFiles(files: string[]): number {
  return files.filter((f) => isDeprecatedWebFile(webRelPath(f))).length
}

export function deprecatedTreeStatus(count: number, baseline: number): DeprecatedTreeStatus {
  const level = count > baseline ? 'grew' : count < baseline ? 'shrank' : 'ok'
  return { count, baseline, level }
}

// #1110: vite cross-feature reach-in ratchet — same shape as the tree ratchet,
// different copy. Re-uses DeprecatedTreeStatus to keep the level enum aligned.
export const viteRatchetStatus = (count: number, baseline: number): DeprecatedTreeStatus =>
  deprecatedTreeStatus(count, baseline)

export function countViteCrossFeatureReachIns(files: string[]): number {
  return checkImports(files).filter((v) => v.reason === 'vite-cross-feature').length
}

export function formatViteRatchetNotice(status: DeprecatedTreeStatus): string | null {
  if (status.level === 'ok') return null
  const refresh = `run \`bun run scripts/lint-module-boundaries.ts --update-baseline\` to set VITE_CROSS_FEATURE_REACH_IN_BASELINE=${status.count}`
  if (status.level === 'grew') {
    return `${status.count} cross-feature reach-in(s) into @/vite/<feature>/<internal>, up from baseline ${status.baseline}. Legitimate cross-feature use should go through the @/vite/<feature> barrel — see docs/architecture/modules.md. If intentional, ${refresh}.`
  }
  return `cross-feature vite reach-ins shrank to ${status.count} (baseline ${status.baseline}) — lock in the migration: ${refresh}.`
}

export function formatDeprecationNotice(status: DeprecatedTreeStatus): string | null {
  if (status.level === 'ok') return null
  const refresh = `run \`bun run scripts/lint-module-boundaries.ts --update-baseline\` to set DEPRECATED_WEB_TREE_BASELINE=${status.count}`
  if (status.level === 'grew') {
    return `${status.count} source file(s) under deprecated web trees (src/vite/, src/components/<feature>/), up from baseline ${status.baseline}. New web features belong in src/modules/<feature>/ — see docs/architecture/modules.md. If intentional, ${refresh}.`
  }
  return `deprecated web tree shrank to ${status.count} (baseline ${status.baseline}) — lock in the migration: ${refresh}.`
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
    for (const { spec, typeOnly } of collectImports(source)) {
      // Rule 1: no cross-module reach into another module's internals.
      const internal = spec.match(INTERNAL_ALIAS_RE)
      if (internal && importingModule !== internal[1]!) {
        violations.push({ file, importPath: spec, reason: 'cross-module-internal' })
      }
      // Rule 2 (#722): no runtime DB import from the web package.
      if (webRel !== null && !typeOnly && isForbiddenWebDbSpec(spec)) {
        violations.push({ file, importPath: spec, reason: 'web-runtime-db' })
      }
      // Rule 3 (#1110): no cross-feature reach into another web vite feature's
      // internals. `@/vite/<feature>/<sub>` from outside `<feature>` is a deep
      // import; legitimate cross-feature use goes through the `@/vite/<feature>`
      // per-feature barrel (which doesn't match the regex). Only enforced for
      // web files — routes/ and other web roots (no feature of their own) reach
      // into vite features and count. Type-only imports DO count: cross-feature
      // type coupling is a real architectural cost (the type lives behind the
      // barrel for a reason); kept consistent with Rule 1.
      const vite = spec.match(VITE_FEATURE_DEEP_RE)
      if (vite && webRel !== null) {
        const fileFeature = viteFeatureOfWebFile(webRel)
        if (fileFeature !== vite[1]!) {
          violations.push({ file, importPath: spec, reason: 'vite-cross-feature' })
        }
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
    return `runtime DB import "${v.importPath}" — packages/web has no direct DB access; route through the Hono API. Use 'import type' for types.`
  }
  if (v.reason === 'vite-cross-feature') {
    return `imports "${v.importPath}" — cross-feature reach-in into another web vite feature; use the '@/vite/<feature>' barrel instead.`
  }
  return `imports "${v.importPath}" — cross-module internal import; use the '@/modules/<name>' barrel instead.`
}

function main(): number {
  const files = discover()
  const violations = checkImports(files)
  const hard = violations.filter((v) => v.reason !== 'vite-cross-feature')
  const viteReachIns = violations.filter((v) => v.reason === 'vite-cross-feature')

  for (const v of hard) {
    process.stderr.write(`[lint-module-boundaries] ERROR ${v.file}: ${describeViolation(v)}\n`)
  }

  // Warning only — the deprecation ratchet must NEVER affect the exit code;
  // only real violations below fail the build. Keep this above the return.
  const deprecationNotice = formatDeprecationNotice(
    deprecatedTreeStatus(countDeprecatedWebFiles(files), DEPRECATED_WEB_TREE_BASELINE),
  )
  if (deprecationNotice) {
    process.stderr.write(`[lint-module-boundaries] WARNING ${deprecationNotice}\n`)
  }

  // #1110: vite reach-in ratchet — fail only when count grew past the baseline.
  // When growing, surface every reach-in so the new one is findable; otherwise
  // keep output quiet (sample of 222 lines per build would be noise).
  const viteStatus = viteRatchetStatus(viteReachIns.length, VITE_CROSS_FEATURE_REACH_IN_BASELINE)
  const viteNotice = formatViteRatchetNotice(viteStatus)
  if (viteStatus.level === 'grew') {
    for (const v of viteReachIns) {
      process.stderr.write(`[lint-module-boundaries] ERROR ${v.file}: ${describeViolation(v)}\n`)
    }
    if (viteNotice) process.stderr.write(`[lint-module-boundaries] ERROR ${viteNotice}\n`)
  } else if (viteNotice) {
    process.stderr.write(`[lint-module-boundaries] WARNING ${viteNotice}\n`)
  }

  const failed = hard.length > 0 || viteStatus.level === 'grew'
  if (failed) {
    const parts: string[] = []
    if (hard.length > 0) parts.push(`${hard.length} hard violation(s)`)
    if (viteStatus.level === 'grew') {
      parts.push(
        `${viteReachIns.length} vite reach-in(s) (baseline ${VITE_CROSS_FEATURE_REACH_IN_BASELINE})`,
      )
    }
    process.stderr.write(`[lint-module-boundaries] ${parts.join(', ')}.\n`)
    return 1
  }
  return 0
}

if (import.meta.main) {
  if (process.argv.includes('--update-baseline')) {
    const files = discover()
    const depCount = countDeprecatedWebFiles(files)
    const viteCount = countViteCrossFeatureReachIns(files)
    const src = readFileSync(import.meta.path, 'utf8')
      .replace(/(const DEPRECATED_WEB_TREE_BASELINE = )\d+/, `$1${depCount}`)
      .replace(/(const VITE_CROSS_FEATURE_REACH_IN_BASELINE = )\d+/, `$1${viteCount}`)
    writeFileSync(import.meta.path, src)
    process.stdout.write(
      `[lint-module-boundaries] DEPRECATED_WEB_TREE_BASELINE=${depCount}, VITE_CROSS_FEATURE_REACH_IN_BASELINE=${viteCount}.\n`,
    )
    process.exit(0)
  }
  process.exit(main())
}
