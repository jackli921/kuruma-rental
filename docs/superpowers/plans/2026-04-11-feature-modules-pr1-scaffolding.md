# Feature Modules PR-1: Scaffolding & Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundation for feature-module discipline: architecture rules doc, two custom lint scripts (file-size caps and module-boundary enforcement), a pre-commit hook, and a public `index.ts` for the existing `modules/auth` folder. No feature code is moved in this PR.

**Architecture:** Two Bun-native check scripts live under `scripts/`, wired into the existing `bun run lint` command. A pre-commit hook runs `lint-staged` which invokes Biome plus the two new scripts on staged files. The rules doc is the canonical reference; `CLAUDE.md` points to it.

**Tech Stack:** Bun (scripts + test runner), Biome 1.9.4 (existing formatter + base lint), husky 9.x, lint-staged 15.x, TypeScript 5.x. No new runtime deps in the app packages — enforcement tooling lives at the repo root only.

**Parent spec:** `docs/superpowers/specs/2026-04-11-feature-modules-design.md`

**Sibling PRs (planned separately after PR-1 lands):**
- **PR-2 Vehicles migration** — moves `lib/vehicle-api.ts`, `lib/vehicles.ts`, `lib/fleet-filters.ts`, `components/vehicles/*`, `api/routes/vehicles.ts`, and vehicle queries from `repositories/drizzle.ts` into `modules/vehicles/`.
- **PR-3 Bookings migration** — same shape for bookings, calendar, and booking-adjacent components.

**This plan builds PR-1 only.** PR-2 and PR-3 will be planned as separate documents against the post-PR-1 state of main.

---

## Pre-flight

- [ ] **Create a dedicated worktree off current main.**

```bash
cd /Users/jack/Dev/kuruma-rental
git fetch origin main
git worktree add ../kuruma-feat-modules-pr1 -b feat/modules-pr1 origin/main
cd ../kuruma-feat-modules-pr1
bun install
```

Verify install succeeds and `bun run lint` passes against unmodified main:

```bash
bun run lint
```

Expected: exit code 0.

- [ ] **Claim the work.** (Optional — there is no issue filed yet for this PR. If one exists, set the `in-progress` label.)

```bash
gh issue list --label in-progress
```

Expected: the output does not include a feature-modules issue already in progress by another session.

---

## File Structure

Files created or modified in this PR.

**Create (new files):**
- `scripts/lint-file-size.ts` — implements R4 (routes.ts cap 150), R7 (page.tsx cap 80), R8 (800 hard / 400 soft warn).
- `scripts/lint-file-size.test.ts` — Bun tests for the file-size script.
- `scripts/lint-module-boundaries.ts` — implements R2 (single public surface) and R3 (no cross-module internal imports).
- `scripts/lint-module-boundaries.test.ts` — Bun tests for the module-boundaries script.
- `scripts/__fixtures__/lint/` — fixture files consumed by the two tests above.
- `docs/architecture/modules.md` — canonical rules doc.
- `packages/web/src/modules/auth/index.ts` — public surface for the existing auth module.
- `packages/api/src/modules/.gitkeep` — empty scaffold for PR-2 to land into.
- `.husky/pre-commit` — git hook that runs `bunx lint-staged`.

**Modify (existing files):**
- `package.json` — add husky + lint-staged dev deps, `prepare` script, wire new scripts into `lint`, add `lint-staged` config.
- `biome.json` — nothing if the custom scripts handle all rules (confirmed below). No edit needed.
- `CLAUDE.md` — add a short pointer to `docs/architecture/modules.md` under a new "Architecture Rules" subsection.
- `packages/web/src/app/[locale]/(auth)/register/page.tsx` — update import from `@/modules/auth/RegisterForm` to `@/modules/auth` (uses the new barrel).
- `packages/web/src/app/[locale]/(auth)/login/page.tsx` — update import from `@/modules/auth/OAuthButtons` to `@/modules/auth`.

**Why this split:** The two lint scripts are independent — failing one does not disable the other — so they are independent files with independent test suites. The rules doc lives in `docs/architecture/` (not `docs/superpowers/specs/`) because it is a living policy document that will evolve, not a one-time design artifact. The `auth/index.ts` is required because without it, the new R2 lint would fire on the two existing `page.tsx` imports and PR-1 would fail its own lint.

**Grandfather policy realization.** The spec suggested a Biome `overrides` block for legacy exemptions, but Biome 1.9's `noRestrictedImports` does not support the glob patterns needed for R2/R3 — so we use custom Bun scripts instead. The grandfather exemption falls out naturally from the script logic:

- **R2/R3** (`lint-module-boundaries.ts`) only flag imports matching `@/modules/<name>/<sub>`. Legacy code at `lib/*` and `components/*` does not use these paths and is silently exempt.
- **R4** (`lint-file-size.ts`) only fires on `modules/*/routes.ts`. Legacy api routes at `api/src/routes/*.ts` live outside `modules/` and get the default 800-line cap.
- **R7** uses an explicit `PAGE_EXEMPT` allowlist for the four existing pages that exceed 80 lines. PR-2 and PR-3 remove entries as they migrate.
- **R8** applies globally with no exemption, matching the spec.

No `biome.json` changes are needed.

---

## Task 1: File-size lint script — 800-line hard cap

**Files:**
- Create: `scripts/__fixtures__/lint/big-file.ts`
- Create: `scripts/__fixtures__/lint/small-file.ts`
- Create: `scripts/lint-file-size.test.ts`
- Create: `scripts/lint-file-size.ts`

- [ ] **Step 1.1: Create fixture files**

Write `scripts/__fixtures__/lint/small-file.ts` with 10 lines of placeholder content:

```ts
// fixture: small source file (10 lines)
export const a = 1
export const b = 2
export const c = 3
export const d = 4
export const e = 5
export const f = 6
export const g = 7
export const h = 8
export const i = 9
```

Write `scripts/__fixtures__/lint/big-file.ts` with 900 lines. Use a small script once to generate it:

```bash
mkdir -p scripts/__fixtures__/lint
{
  echo "// fixture: oversized source file (900 lines)"
  for i in $(seq 1 899); do echo "export const v$i = $i"; done
} > scripts/__fixtures__/lint/big-file.ts
wc -l scripts/__fixtures__/lint/big-file.ts
```

Expected: `900 scripts/__fixtures__/lint/big-file.ts`.

- [ ] **Step 1.2: Write the failing test**

Create `scripts/lint-file-size.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { checkFiles } from './lint-file-size'

const FIXTURES = 'scripts/__fixtures__/lint'

describe('lint-file-size', () => {
  test('reports a hard failure for a file over 800 lines', () => {
    const report = checkFiles([`${FIXTURES}/big-file.ts`])
    const errors = report.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.file).toBe(`${FIXTURES}/big-file.ts`)
    expect(errors[0]!.lines).toBe(900)
    expect(errors[0]!.cap).toBe(800)
  })

  test('does not report a small file', () => {
    const report = checkFiles([`${FIXTURES}/small-file.ts`])
    expect(report).toHaveLength(0)
  })
})
```

- [ ] **Step 1.3: Run the test and verify it fails**

Run:

```bash
bun test scripts/lint-file-size.test.ts
```

Expected: both tests fail with `Cannot find module './lint-file-size'` or similar.

- [ ] **Step 1.4: Implement the minimal script**

Create `scripts/lint-file-size.ts`:

```ts
#!/usr/bin/env bun
import { readFileSync } from 'node:fs'

const HARD_FAIL = 800
const SOFT_WARN = 400

export type Issue = {
  file: string
  lines: number
  cap: number
  level: 'warn' | 'error'
}

export function checkFiles(files: string[]): Issue[] {
  const issues: Issue[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n').length
    if (lines > HARD_FAIL) {
      issues.push({ file, lines, cap: HARD_FAIL, level: 'error' })
    } else if (lines > SOFT_WARN) {
      issues.push({ file, lines, cap: SOFT_WARN, level: 'warn' })
    }
  }
  return issues
}
```

- [ ] **Step 1.5: Run the test and verify it passes**

```bash
bun test scripts/lint-file-size.test.ts
```

Expected: both tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add scripts/__fixtures__/lint scripts/lint-file-size.ts scripts/lint-file-size.test.ts
git commit -m "feat(lint): add file-size check with 800-line hard cap"
```

---

## Task 2: File-size lint script — 400-line soft warn

**Files:**
- Create: `scripts/__fixtures__/lint/medium-file.ts`
- Modify: `scripts/lint-file-size.test.ts`

- [ ] **Step 2.1: Create the medium-sized fixture**

```bash
{
  echo "// fixture: 500-line source file"
  for i in $(seq 1 499); do echo "export const m$i = $i"; done
} > scripts/__fixtures__/lint/medium-file.ts
wc -l scripts/__fixtures__/lint/medium-file.ts
```

Expected: `500 scripts/__fixtures__/lint/medium-file.ts`.

- [ ] **Step 2.2: Add the failing test**

Append to `scripts/lint-file-size.test.ts`:

```ts
  test('reports a soft warning for a file between 400 and 800 lines', () => {
    const report = checkFiles([`${FIXTURES}/medium-file.ts`])
    const warnings = report.filter((r) => r.level === 'warn')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.file).toBe(`${FIXTURES}/medium-file.ts`)
    expect(warnings[0]!.lines).toBe(500)
    expect(warnings[0]!.cap).toBe(400)
  })
```

- [ ] **Step 2.3: Run the test**

```bash
bun test scripts/lint-file-size.test.ts
```

Expected: the new test passes (the implementation from Task 1 already handles this — this task is exercising the branch in a test).

If it fails, double-check that `SOFT_WARN = 400` and the `else if` branch are correct in `scripts/lint-file-size.ts`.

- [ ] **Step 2.4: Commit**

```bash
git add scripts/__fixtures__/lint/medium-file.ts scripts/lint-file-size.test.ts
git commit -m "test(lint): cover file-size soft warning at 400 lines"
```

---

## Task 3: File-size lint script — path-based caps for routes.ts and page.tsx

**Files:**
- Create: `scripts/__fixtures__/lint/modules/demo/routes.ts`
- Create: `scripts/__fixtures__/lint/app/locale/demo/page.tsx`
- Modify: `scripts/lint-file-size.ts`
- Modify: `scripts/lint-file-size.test.ts`

- [ ] **Step 3.1: Create the path-specific fixtures**

```bash
mkdir -p scripts/__fixtures__/lint/modules/demo
mkdir -p scripts/__fixtures__/lint/app/locale/demo

{
  echo "// fixture: oversized routes.ts (200 lines)"
  for i in $(seq 1 199); do echo "export const r$i = $i"; done
} > scripts/__fixtures__/lint/modules/demo/routes.ts

{
  echo "// fixture: oversized page.tsx (100 lines)"
  for i in $(seq 1 99); do echo "export const p$i = $i"; done
} > scripts/__fixtures__/lint/app/locale/demo/page.tsx
```

- [ ] **Step 3.2: Add the failing tests**

Append to `scripts/lint-file-size.test.ts`:

```ts
  test('enforces 150-line cap on modules/*/routes.ts', () => {
    const report = checkFiles([`${FIXTURES}/modules/demo/routes.ts`])
    const errors = report.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.cap).toBe(150)
    expect(errors[0]!.lines).toBe(200)
  })

  test('enforces 80-line cap on app/**/page.tsx', () => {
    const report = checkFiles([`${FIXTURES}/app/locale/demo/page.tsx`])
    const errors = report.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.cap).toBe(80)
    expect(errors[0]!.lines).toBe(100)
  })
```

- [ ] **Step 3.3: Run the tests and watch them fail**

```bash
bun test scripts/lint-file-size.test.ts
```

Expected: the two new tests fail — the current script uses a single 800-line cap for everything.

- [ ] **Step 3.4: Extend the script with per-path caps and a legacy page allowlist**

Replace the body of `scripts/lint-file-size.ts` with:

```ts
#!/usr/bin/env bun
import { readFileSync } from 'node:fs'

const HARD_FAIL = 800
const SOFT_WARN = 400
const ROUTES_CAP = 150
const PAGE_CAP = 80

/**
 * Pages that existed before R7 landed and exceed the 80-line cap.
 * They get the general 800/400 rule instead of the 80-line hard cap.
 *
 * Ratchet rules:
 * - PR-2 (vehicles migration) REMOVES vehicles pages from this list.
 * - PR-3 (bookings migration) REMOVES bookings pages from this list.
 * - Never ADD a path here. If a new page exceeds 80 lines, refactor it
 *   into modules/<feature>/ instead.
 */
const PAGE_EXEMPT: ReadonlySet<string> = new Set([
  'packages/web/src/app/[locale]/vehicles/[id]/page.tsx',
  'packages/web/src/app/[locale]/vehicles/page.tsx',
  'packages/web/src/app/[locale]/(renter)/bookings/page.tsx',
  'packages/web/src/app/[locale]/bookings/confirmation/page.tsx',
])

export type Issue = {
  file: string
  lines: number
  cap: number
  level: 'warn' | 'error'
}

type CapRule = { cap: number; soft: number | null }

function capForFile(path: string): CapRule {
  // Normalize path separators for cross-platform matching.
  const p = path.replaceAll('\\', '/')
  if (/\/modules\/[^/]+\/routes\.ts$/.test(p)) {
    return { cap: ROUTES_CAP, soft: null }
  }
  if (/\/app\/.+\/page\.tsx$/.test(p) && !PAGE_EXEMPT.has(p)) {
    return { cap: PAGE_CAP, soft: null }
  }
  return { cap: HARD_FAIL, soft: SOFT_WARN }
}

export function checkFiles(files: string[]): Issue[] {
  const issues: Issue[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n').length
    const rule = capForFile(file)
    if (lines > rule.cap) {
      issues.push({ file, lines, cap: rule.cap, level: 'error' })
    } else if (rule.soft !== null && lines > rule.soft) {
      issues.push({ file, lines, cap: rule.soft, level: 'warn' })
    }
  }
  return issues
}
```

**Why the allowlist:** Four pages currently exceed 80 lines (`vehicles/[id]`, `vehicles/page.tsx`, `(renter)/bookings`, `bookings/confirmation`). Three of the four get thinned out by the PR-2 (vehicles) and PR-3 (bookings) migrations, which pull logic out of the page into `modules/<feature>/`. The allowlist is the ratchet: PR-1 freezes the current state, PR-2 and PR-3 remove entries as they migrate, and any new page must land under the 80-line cap.

- [ ] **Step 3.5: Add a test for the page allowlist**

The allowlist logic must also be covered. Append to `scripts/lint-file-size.test.ts`:

```ts
  test('exempts allowlisted legacy pages from the 80-line cap', () => {
    // Temporarily extend the allowlist check by using a real legacy path.
    // The script's PAGE_EXEMPT set is module-private, so this test asserts
    // behavior: an exempt path over 80 lines should NOT produce an error,
    // it should fall through to the general 800/400 rule.
    const legacyFixture = 'packages/web/src/app/[locale]/vehicles/page.tsx'
    const report = checkFiles([legacyFixture])
    const errors = report.filter((r) => r.level === 'error')
    // File is 106 lines; not over 800 hard cap and not over 400 soft warn for
    // general files means zero errors and zero warnings.
    expect(errors).toHaveLength(0)
  })
```

Note: this test reads a real repo file. If its line count changes so that it crosses the 400 soft-warn threshold, the test will produce a warning (not an error) and still pass. If it grows past 800, the test will fail — which is the correct signal to refactor that page.

- [ ] **Step 3.6: Run the tests and verify all pass**

```bash
bun test scripts/lint-file-size.test.ts
```

Expected: all six tests pass.

- [ ] **Step 3.8: Commit**

```bash
git add scripts/__fixtures__/lint/modules scripts/__fixtures__/lint/app scripts/lint-file-size.ts scripts/lint-file-size.test.ts
git commit -m "feat(lint): per-path file-size caps for routes.ts and page.tsx"
```

---

## Task 4: File-size lint script — CLI entry point, file discovery, exclusions

**Files:**
- Modify: `scripts/lint-file-size.ts`
- Modify: `scripts/lint-file-size.test.ts`

- [ ] **Step 4.1: Add the failing test for file discovery + exclusions**

Append to `scripts/lint-file-size.test.ts`:

```ts
import { discoverFiles } from './lint-file-size'

describe('lint-file-size discovery', () => {
  test('includes source files under packages/*/src', () => {
    const files = discoverFiles(['packages/web/src'])
    expect(files.length).toBeGreaterThan(0)
    expect(files.every((f) => f.endsWith('.ts') || f.endsWith('.tsx'))).toBe(true)
  })

  test('excludes .test.ts, .test.tsx, node_modules, .next, dist', () => {
    const files = discoverFiles(['packages/web/src'])
    expect(files.some((f) => f.includes('.test.'))).toBe(false)
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes('.next'))).toBe(false)
  })
})
```

- [ ] **Step 4.2: Run the test and watch it fail**

```bash
bun test scripts/lint-file-size.test.ts
```

Expected: the two new tests fail because `discoverFiles` is not exported.

- [ ] **Step 4.3: Implement `discoverFiles` + CLI entry point**

Append to `scripts/lint-file-size.ts`:

```ts
import { Glob } from 'bun'

const ROOTS = [
  'packages/api/src',
  'packages/web/src',
  'packages/shared/src',
]

const INCLUDE_PATTERNS = ['**/*.ts', '**/*.tsx']
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

export function discoverFiles(roots: string[] = ROOTS): string[] {
  const out: string[] = []
  for (const root of roots) {
    for (const pattern of INCLUDE_PATTERNS) {
      const glob = new Glob(pattern)
      for (const rel of glob.scanSync({ cwd: root, onlyFiles: true })) {
        const full = `${root}/${rel}`
        if (EXCLUDE_PATTERNS.some((r) => r.test(full))) continue
        out.push(full)
      }
    }
  }
  return out
}

function main(): number {
  const files = discoverFiles()
  const issues = checkFiles(files)

  let errors = 0
  let warnings = 0
  for (const issue of issues) {
    const tag = issue.level === 'error' ? 'ERROR' : 'WARN'
    const stream = issue.level === 'error' ? process.stderr : process.stdout
    stream.write(
      `[lint-file-size] ${tag} ${issue.file}: ${issue.lines} lines (cap ${issue.cap})\n`,
    )
    if (issue.level === 'error') errors++
    else warnings++
  }

  if (errors > 0) {
    process.stderr.write(
      `[lint-file-size] ${errors} error(s), ${warnings} warning(s)\n`,
    )
    return 1
  }
  if (warnings > 0) {
    process.stdout.write(`[lint-file-size] ${warnings} warning(s)\n`)
  }
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
```

- [ ] **Step 4.4: Run the tests and verify all pass**

```bash
bun test scripts/lint-file-size.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.5: Run the script against the whole repo**

```bash
bun run scripts/lint-file-size.ts
```

Expected: exit code 0 (no errors). Any warnings are fine — the spec allows them. Note any files that warn and mention them in the PR description.

- [ ] **Step 4.6: Commit**

```bash
git add scripts/lint-file-size.ts scripts/lint-file-size.test.ts
git commit -m "feat(lint): add CLI entry point and file discovery to lint-file-size"
```

---

## Task 5: Module-boundaries lint script — baseline cross-module internal-import detection

**Files:**
- Create: `scripts/__fixtures__/boundaries/modules/vehicles/api.ts`
- Create: `scripts/__fixtures__/boundaries/modules/vehicles/components.tsx`
- Create: `scripts/__fixtures__/boundaries/modules/vehicles/index.ts`
- Create: `scripts/__fixtures__/boundaries/modules/bookings/api.ts`
- Create: `scripts/__fixtures__/boundaries/app/bad-page.tsx`
- Create: `scripts/__fixtures__/boundaries/app/good-page.tsx`
- Create: `scripts/lint-module-boundaries.test.ts`
- Create: `scripts/lint-module-boundaries.ts`

- [ ] **Step 5.1: Create boundary fixture files**

```bash
mkdir -p scripts/__fixtures__/boundaries/modules/vehicles
mkdir -p scripts/__fixtures__/boundaries/modules/bookings
mkdir -p scripts/__fixtures__/boundaries/app
```

Write `scripts/__fixtures__/boundaries/modules/vehicles/api.ts`:

```ts
export function fetchVehicles(): string[] { return [] }
```

Write `scripts/__fixtures__/boundaries/modules/vehicles/components.tsx`:

```tsx
export function VehicleCard() { return null as unknown as JSX.Element }
```

Write `scripts/__fixtures__/boundaries/modules/vehicles/index.ts`:

```ts
export { fetchVehicles } from './api'
export { VehicleCard } from './components'
```

Write `scripts/__fixtures__/boundaries/modules/bookings/api.ts`:

```ts
// VIOLATION: reaching into another module's internals
import { fetchVehicles } from '@/modules/vehicles/api'
export function bookSomething() { return fetchVehicles() }
```

Write `scripts/__fixtures__/boundaries/app/bad-page.tsx`:

```tsx
// VIOLATION: reaching into a module's internal file from a page
import { VehicleCard } from '@/modules/vehicles/components'
export default function Page() { return <VehicleCard /> }
```

Write `scripts/__fixtures__/boundaries/app/good-page.tsx`:

```tsx
// OK: uses the public barrel
import { VehicleCard } from '@/modules/vehicles'
export default function Page() { return <VehicleCard /> }
```

- [ ] **Step 5.2: Write the failing test**

Create `scripts/lint-module-boundaries.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { checkImports } from './lint-module-boundaries'

const FIX = 'scripts/__fixtures__/boundaries'

describe('lint-module-boundaries', () => {
  test('flags a cross-module internal import from another module', () => {
    const report = checkImports([`${FIX}/modules/bookings/api.ts`])
    expect(report).toHaveLength(1)
    expect(report[0]!.file).toBe(`${FIX}/modules/bookings/api.ts`)
    expect(report[0]!.importPath).toBe('@/modules/vehicles/api')
    expect(report[0]!.reason).toBe('cross-module-internal')
  })

  test('flags a cross-module internal import from a page', () => {
    const report = checkImports([`${FIX}/app/bad-page.tsx`])
    expect(report).toHaveLength(1)
    expect(report[0]!.importPath).toBe('@/modules/vehicles/components')
  })

  test('allows importing from a module barrel', () => {
    const report = checkImports([`${FIX}/app/good-page.tsx`])
    expect(report).toHaveLength(0)
  })

  test('allows same-module internal imports via the barrel', () => {
    const report = checkImports([`${FIX}/modules/vehicles/index.ts`])
    expect(report).toHaveLength(0)
  })
})
```

- [ ] **Step 5.3: Run the tests and watch them fail**

```bash
bun test scripts/lint-module-boundaries.test.ts
```

Expected: all tests fail with `Cannot find module './lint-module-boundaries'`.

- [ ] **Step 5.4: Implement the minimal script**

Create `scripts/lint-module-boundaries.ts`:

```ts
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

// Matches an alias import that reaches into a module's internals:
//   @/modules/<name>/<something>
// Captures: 1 = module name, 2 = sub-path (the "something")
const INTERNAL_ALIAS_RE = /^@\/modules\/([^/]+)\/(.+)$/

function collectImports(source: string): string[] {
  const specs: string[] = []
  let match: RegExpExecArray | null
  while ((match = IMPORT_RE.exec(source)) !== null) specs.push(match[1]!)
  while ((match = BARE_IMPORT_RE.exec(source)) !== null) specs.push(match[1]!)
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
    const source = readFileSync(file, 'utf8')
    const importingModule = moduleOfFile(file)
    for (const spec of collectImports(source)) {
      const m = spec.match(INTERNAL_ALIAS_RE)
      if (!m) continue
      const [, targetModule] = m as unknown as [string, string, string]
      // Allow a file inside the same module to reach its own internals (though
      // relative imports are preferred). This check concerns cross-module only.
      if (importingModule === targetModule) continue
      violations.push({ file, importPath: spec, reason: 'cross-module-internal' })
    }
  }
  return violations
}
```

- [ ] **Step 5.5: Run the tests and verify all pass**

```bash
bun test scripts/lint-module-boundaries.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add scripts/__fixtures__/boundaries scripts/lint-module-boundaries.ts scripts/lint-module-boundaries.test.ts
git commit -m "feat(lint): add module-boundary check for cross-module internal imports"
```

---

## Task 6: Module-boundaries lint script — CLI entry point

**Files:**
- Modify: `scripts/lint-module-boundaries.ts`

- [ ] **Step 6.1: Append discovery + CLI entry point**

Append to `scripts/lint-module-boundaries.ts`:

```ts
import { Glob } from 'bun'

const ROOTS = ['packages/api/src', 'packages/web/src', 'packages/shared/src']
const INCLUDE_PATTERNS = ['**/*.ts', '**/*.tsx']
const EXCLUDE_PATTERNS = [
  /\.test\.tsx?$/,
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
  for (const root of ROOTS) {
    for (const pattern of INCLUDE_PATTERNS) {
      const glob = new Glob(pattern)
      for (const rel of glob.scanSync({ cwd: root, onlyFiles: true })) {
        const full = `${root}/${rel}`
        if (EXCLUDE_PATTERNS.some((r) => r.test(full))) continue
        out.push(full)
      }
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
```

- [ ] **Step 6.2: Run the script against the whole repo**

```bash
bun run scripts/lint-module-boundaries.ts
```

Expected: exit code 1, with violations listed for the existing `page.tsx` imports that reach into `@/modules/auth/RegisterForm` and `@/modules/auth/OAuthButtons`. **This is expected** — Task 9 fixes those call sites after Task 8 adds the barrel.

- [ ] **Step 6.3: Commit**

```bash
git add scripts/lint-module-boundaries.ts
git commit -m "feat(lint): add CLI entry point to lint-module-boundaries"
```

---

## Task 7: Wire both lint scripts into `bun run lint`

**Files:**
- Modify: `package.json`

- [ ] **Step 7.1: Update package.json scripts**

Edit `package.json` and replace the `lint` and `lint:fix` scripts:

```json
    "lint": "bunx biome check . && bun run lint:size && bun run lint:modules",
    "lint:fix": "bunx biome check --write .",
    "lint:size": "bun run scripts/lint-file-size.ts",
    "lint:modules": "bun run scripts/lint-module-boundaries.ts",
```

- [ ] **Step 7.2: Run the full lint**

```bash
bun run lint
```

Expected: Biome passes, `lint:size` passes, `lint:modules` fails with violations against the existing `auth/RegisterForm` and `auth/OAuthButtons` imports. Exit code 1. **This is expected** — Tasks 8 and 9 fix it.

- [ ] **Step 7.3: Commit**

```bash
git add package.json
git commit -m "chore(lint): wire lint-file-size and lint-module-boundaries into bun run lint"
```

---

## Task 8: Add public barrel to `modules/auth`

**Files:**
- Create: `packages/web/src/modules/auth/index.ts`

- [ ] **Step 8.1: Inspect the existing auth module to know what to export**

```bash
ls packages/web/src/modules/auth
```

Expected: `RegisterForm.tsx`, `OAuthButtons.tsx`, `actions.ts` (and possibly others).

Peek at each file to confirm its named exports:

```bash
grep -E "^export " packages/web/src/modules/auth/RegisterForm.tsx
grep -E "^export " packages/web/src/modules/auth/OAuthButtons.tsx
grep -E "^export " packages/web/src/modules/auth/actions.ts
```

Note each export name for the barrel.

- [ ] **Step 8.2: Create the barrel**

Create `packages/web/src/modules/auth/index.ts`. The exact contents depend on Step 8.1, but follow this shape:

```ts
export { RegisterForm } from './RegisterForm'
export { OAuthButtons } from './OAuthButtons'
// Only export from actions.ts if a file outside modules/auth currently imports it.
// If actions.ts is only used by RegisterForm / OAuthButtons internally, leave it out.
```

Rule of thumb (R12): a symbol goes in the barrel only if something **outside** `modules/auth/` imports it. Check before adding:

```bash
grep -rE "from '@/modules/auth" packages/web/src packages/api/src
```

Add to the barrel only the symbols that appear in grep results.

- [ ] **Step 8.3: Run the module-boundaries lint**

```bash
bun run lint:modules
```

Expected: **still fails**, because the existing page.tsx files still import from `@/modules/auth/RegisterForm` and `@/modules/auth/OAuthButtons` directly. Task 9 fixes those call sites.

- [ ] **Step 8.4: Commit**

```bash
git add packages/web/src/modules/auth/index.ts
git commit -m "feat(web): add public barrel to modules/auth"
```

---

## Task 9: Update auth module call sites to use the barrel

**Files:**
- Modify: `packages/web/src/app/[locale]/(auth)/register/page.tsx`
- Modify: `packages/web/src/app/[locale]/(auth)/login/page.tsx`

- [ ] **Step 9.1: Update register page import**

Read `packages/web/src/app/[locale]/(auth)/register/page.tsx` and change:

```ts
import { RegisterForm } from '@/modules/auth/RegisterForm'
```

to:

```ts
import { RegisterForm } from '@/modules/auth'
```

- [ ] **Step 9.2: Update login page import**

Read `packages/web/src/app/[locale]/(auth)/login/page.tsx` and change:

```ts
import { OAuthButtons } from '@/modules/auth/OAuthButtons'
```

to:

```ts
import { OAuthButtons } from '@/modules/auth'
```

- [ ] **Step 9.3: Run the full lint**

```bash
bun run lint
```

Expected: exit code 0. Biome passes, `lint:size` passes, `lint:modules` passes.

- [ ] **Step 9.4: Run the web typecheck to confirm no regressions**

```bash
bun run --filter @kuruma/web typecheck 2>/dev/null || bunx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 9.5: Run the web test suite**

```bash
bun run --filter @kuruma/web test
```

Expected: all tests pass.

- [ ] **Step 9.6: Commit**

```bash
git add packages/web/src/app/[locale]/\(auth\)/register/page.tsx packages/web/src/app/[locale]/\(auth\)/login/page.tsx
git commit -m "refactor(web): route auth imports through modules/auth barrel"
```

---

## Task 9b: Scaffold the api-side modules folder

**Files:**
- Create: `packages/api/src/modules/.gitkeep`

The spec calls for an empty `modules/` directory scaffold on both sides. `packages/web/src/modules/` already exists (it contains `auth/`), so nothing is needed there. `packages/api/src/modules/` does not yet exist — create it with a `.gitkeep` so the folder is committed and PR-2 has a landing spot.

- [ ] **Step 9b.1: Create the folder**

```bash
mkdir -p packages/api/src/modules
: > packages/api/src/modules/.gitkeep
```

- [ ] **Step 9b.2: Verify it is tracked**

```bash
git status --short packages/api/src/modules
```

Expected: `?? packages/api/src/modules/.gitkeep`.

- [ ] **Step 9b.3: Commit**

```bash
git add packages/api/src/modules/.gitkeep
git commit -m "chore(api): scaffold empty src/modules folder for PR-2 landing"
```

---

## Task 10: Write the architecture rules doc

**Files:**
- Create: `docs/architecture/modules.md`

- [ ] **Step 10.1: Create the doc**

Create `docs/architecture/modules.md` with this content (ship it verbatim — adjust only if you spot a factual error):

```markdown
# Feature Modules & Fan-Out Discipline

This is the canonical rules doc. The design rationale lives in
`docs/superpowers/specs/2026-04-11-feature-modules-design.md`.

## The one-line rule

**A small semantic change should touch few files.** If you can't make a small
change without editing a dozen files, the architecture is wrong — fix the
architecture, don't fight it.

## Target layout

Feature code lives under `src/modules/<feature>/` in each package.

### packages/api

    modules/<feature>/
      routes.ts      # thin Hono controller: parse, call service, respond
      service.ts     # business rules, invariants, orchestration
      repo.ts        # Drizzle queries only, no logic
      index.ts       # public surface (usually { router, types })
      *.test.ts

Cross-module helpers live in `packages/api/src/lib/`. `app.ts` mounts each
module's router.

### packages/web

    modules/<feature>/
      api.ts         # fetch calls to the Hono API
      components/    # feature components (VehicleForm, BookingCard, …)
      hooks.ts       # feature-specific hooks
      types.ts       # feature-local types
      index.ts       # public surface
      *.test.ts / *.test.tsx

Pages in `src/app/.../page.tsx` stay thin and import from
`@/modules/<feature>`. Cross-module primitives go in `src/lib/`. Design-system
primitives stay in `src/components/ui/`.

### packages/shared

No changes. Schema and validators already live in per-feature files.

## The rules

| # | Rule | Enforced by |
|---|---|---|
| R1  | Feature = one folder under `src/modules/<feature>/` | convention + review |
| R2  | Single public surface: import only from `@/modules/<feature>` (the barrel) | `scripts/lint-module-boundaries.ts` |
| R3  | No cross-module internal imports | `scripts/lint-module-boundaries.ts` |
| R4  | `routes.ts` contains no business logic, max 150 lines | `scripts/lint-file-size.ts` |
| R5  | `service.ts` has one responsibility, no "misc" or "utils" services | review |
| R6  | `repo.ts` is pure data access, no validation, no side effects | review |
| R7  | `page.tsx` is thin composition, max 80 lines | `scripts/lint-file-size.ts` |
| R8  | Source files: soft warn at 400 lines, hard fail at 800 lines | `scripts/lint-file-size.ts` |
| R9  | Rule of three for DRY: duplicate first, extract on the third use | convention |
| R10 | Cross-module helpers live in `lib/`, never inside another module | R3 + review |
| R11 | Tests colocate with the code they test | convention |
| R12 | `index.ts` exports only what the outside actually uses | review |

## Grandfather policy

Legacy files under `lib/` and `components/<feature>/` are exempt from
R2/R3/R4/R7 until they are migrated. R8 (file size) applies everywhere.

**Migrate before you modify.** Before making any non-trivial change to a
grandfathered feature, land a standalone migration PR that moves it into
`modules/<feature>/`. The feature-change PR builds on top. Migrations and
feature changes never share a PR.

Trivial exceptions: typo fixes, one-line string tweaks, dependency bumps.

## How to add a new feature

1. Create `packages/api/src/modules/<feature>/` with `routes.ts`,
   `service.ts`, `repo.ts`, `index.ts`, and tests.
2. Mount the router in `packages/api/src/app.ts`.
3. Create `packages/web/src/modules/<feature>/` with `api.ts`,
   `components/`, `hooks.ts`, `types.ts`, `index.ts`, and tests.
4. Import from `@/modules/<feature>` in pages. Never reach into internals.
5. Run `bun run lint` before committing.

## How to migrate a grandfathered feature

1. Create the `modules/<feature>/` folders in api and web.
2. Move files into their new homes (one commit per logical move).
3. Update imports across the monorepo (can be done in the same commit as
   the move, since the move would break the build otherwise).
4. Move tests alongside the code they test.
5. Run `bun run lint`, `bun run test`, `bun run --filter @kuruma/api test:integration`,
   and the relevant builds. All must pass.
6. Open the migration PR. It should contain only file moves and import
   updates — no logic changes.
```

- [ ] **Step 10.2: Commit**

```bash
git add docs/architecture/modules.md
git commit -m "docs(architecture): canonical rules doc for feature modules"
```

---

## Task 11: Add pointer in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 11.1: Find the insertion point**

The new section should go after the existing "Vertical Slice TDD" section and before "Issue Tracking & Session Protocol". Read `CLAUDE.md` and locate the line `# Issue Tracking & Session Protocol`.

- [ ] **Step 11.2: Insert the architecture section**

Insert this block immediately before the `# Issue Tracking & Session Protocol` heading:

```markdown
---

# Architecture Rules (Feature Modules)

Feature code lives under `src/modules/<feature>/` in each package. Thin
controllers, deep services, single-responsibility repos, single public surface
via `index.ts`. File-size caps enforced by `bun run lint`.

**Canonical rules doc:** `docs/architecture/modules.md` — read this before
adding new features or editing existing ones.

**Grandfather policy (strict):** before any non-trivial change to a feature
that still lives under `lib/` or `components/<feature>/`, land a standalone
migration PR that moves it into `modules/<feature>/`. The feature-change PR
builds on top. Migrations and feature changes never share a PR. Trivial
exceptions: typo fixes, one-line string tweaks, dependency bumps.

Enforcement:
- `bun run lint:size` — file-size caps (R4, R7, R8)
- `bun run lint:modules` — cross-module internal-import detection (R2, R3)
- `.husky/pre-commit` runs both via `lint-staged` on staged files before every commit

```

- [ ] **Step 11.3: Verify nothing else changed**

```bash
git diff CLAUDE.md
```

Expected: only the new section is added. No other edits.

- [ ] **Step 11.4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): point to feature modules architecture rules"
```

---

## Task 12: Install husky + lint-staged

**Files:**
- Modify: `package.json`
- Create: `.husky/pre-commit`
- Create: `.husky/_/` (managed by husky init)

- [ ] **Step 12.1: Install the dev dependencies**

```bash
bun add -D husky lint-staged
```

Expected: both packages added to root `package.json` under `devDependencies`. `bun.lock` updated.

- [ ] **Step 12.2: Initialize husky**

```bash
bunx husky init
```

Expected: creates `.husky/pre-commit` with a default `npm test` line and adds `"prepare": "husky"` to root `package.json` scripts.

- [ ] **Step 12.3: Replace the default pre-commit hook**

Overwrite `.husky/pre-commit` with:

```sh
bunx lint-staged
```

Do not keep a shebang or any other husky boilerplate — husky 9 runs the file as a shell script by default.

- [ ] **Step 12.4: Add lint-staged config to package.json**

Edit `package.json` and add a top-level `lint-staged` key:

```json
  "lint-staged": {
    "*.{ts,tsx}": [
      "bunx biome check --no-errors-on-unmatched",
      "bun run scripts/lint-file-size.ts",
      "bun run scripts/lint-module-boundaries.ts",
      "bunx tsc --noEmit -p packages/web/tsconfig.json",
      "bunx tsc --noEmit -p packages/api/tsconfig.json"
    ]
  }
```

**Rationale:** The file-size and module-boundaries scripts currently walk the whole tree. That is fine for pre-commit — the scripts finish in under a second because the repo is small, and running them on the whole tree means a staged file that imports a forbidden symbol from an unstaged file still gets caught. If pre-commit becomes slow as the codebase grows, extend the scripts to accept a file list and wire that in. The two `tsc --noEmit` runs catch type regressions at commit time per the spec's enforcement section; they each take roughly 3–5 seconds on this repo today, keeping the whole hook under the spec's 5-second target only if combined runtime stays low — revisit if it grows.

- [ ] **Step 12.5: Sanity-check the install**

```bash
cat .husky/pre-commit
cat package.json | grep -A 5 lint-staged
```

Expected: pre-commit contains `bunx lint-staged`, package.json has the `lint-staged` key.

- [ ] **Step 12.6: Commit**

```bash
git add package.json bun.lock .husky
git commit -m "chore(tooling): install husky + lint-staged for pre-commit lint gate"
```

---

## Task 13: Verify the pre-commit hook fires correctly

**Files:** None (verification only)

- [ ] **Step 13.1: Intentionally break a file**

Add a violation to one of the auth call sites temporarily. Edit `packages/web/src/app/[locale]/(auth)/register/page.tsx` and change:

```ts
import { RegisterForm } from '@/modules/auth'
```

back to:

```ts
import { RegisterForm } from '@/modules/auth/RegisterForm'
```

- [ ] **Step 13.2: Attempt to commit the broken file**

```bash
git add packages/web/src/app/[locale]/\(auth\)/register/page.tsx
git commit -m "test: this commit should fail"
```

Expected: the commit **fails** with a lint-staged error output that includes a line from `lint-module-boundaries` reporting the violation against the register page.

- [ ] **Step 13.3: Revert the bad change**

```bash
git checkout -- packages/web/src/app/[locale]/\(auth\)/register/page.tsx
git status
```

Expected: working tree clean (or only the staged revert).

- [ ] **Step 13.4: Confirm a clean commit still works**

Make a trivial no-op change to confirm the hook does not block good commits:

```bash
echo "" >> docs/architecture/modules.md
git add docs/architecture/modules.md
git commit -m "chore: verify pre-commit hook allows clean commits"
```

Expected: commit succeeds.

- [ ] **Step 13.5: Revert the no-op commit**

```bash
git reset --soft HEAD~1
git checkout -- docs/architecture/modules.md
git status
```

Expected: working tree clean, HEAD back one commit.

---

## Task 14: Final end-to-end verification

**Files:** None (verification only)

- [ ] **Step 14.1: Run the full lint**

```bash
bun run lint
```

Expected: exit code 0.

- [ ] **Step 14.2: Run all tests**

```bash
bun run test
```

Expected: all packages pass.

- [ ] **Step 14.3: Run the web typecheck + build**

```bash
bunx tsc --noEmit -p packages/web/tsconfig.json
bun run --filter @kuruma/web build
```

Expected: both succeed.

- [ ] **Step 14.4: Run the api typecheck**

```bash
bunx tsc --noEmit -p packages/api/tsconfig.json
```

Expected: no errors.

- [ ] **Step 14.5: Run db:verify (if schema is touched, it is not in this PR)**

```bash
bun run db:verify
```

Expected: passes or is cleanly skipped (no `DATABASE_URL`).

- [ ] **Step 14.6: Rebase on latest main and re-run verification**

```bash
git fetch origin main
git rebase origin/main
bun run lint
bun run test
```

Expected: clean rebase (no conflicts), all green.

---

## Task 15: Open the PR

**Files:** None (workflow)

- [ ] **Step 15.1: Push the branch**

```bash
git push -u origin feat/modules-pr1
```

- [ ] **Step 15.2: Open the PR**

```bash
gh pr create --title "feat(arch): feature modules scaffolding and enforcement (PR-1)" --body "$(cat <<'EOF'
## Summary

- Adds `docs/architecture/modules.md` — canonical rules doc for feature modules (thin controllers, deep services, single public surface, file-size caps, rule of three for DRY).
- Adds `scripts/lint-file-size.ts` — enforces R4 (routes.ts ≤ 150 lines), R7 (page.tsx ≤ 80 lines), R8 (source ≤ 800 hard / 400 soft warn).
- Adds `scripts/lint-module-boundaries.ts` — enforces R2/R3 (no cross-module internal imports; must go through `index.ts` barrel).
- Wires both scripts into `bun run lint`.
- Adds husky + lint-staged and a pre-commit hook that runs the lint gate on staged files.
- Adds `packages/web/src/modules/auth/index.ts` (public barrel for the existing auth module).
- Updates the two auth page imports to use the barrel.
- Scaffolds an empty `packages/api/src/modules/` folder so PR-2 has a landing spot.
- Adds a short pointer in `CLAUDE.md` to the architecture doc.

**No feature code is moved in this PR.** PR-2 (vehicles) and PR-3 (bookings) follow with their own plans.

## Why

Veteran-engineer heuristic: a healthy codebase gets more modular over time, so late-stage small changes should touch few files. This PR lays the enforcement rails while the codebase is still small.

## Design spec

- `docs/superpowers/specs/2026-04-11-feature-modules-design.md`

## Test plan

- [x] `bun run lint` passes
- [x] `bun run test` passes across all packages
- [x] `bunx tsc --noEmit -p packages/web/tsconfig.json` passes
- [x] `bunx tsc --noEmit -p packages/api/tsconfig.json` passes
- [x] `bun run --filter @kuruma/web build` passes
- [x] Pre-commit hook blocks a commit that introduces a cross-module internal import (verified in Task 13)
- [x] Pre-commit hook allows a clean commit
- [x] Biome lint still passes on unchanged code

## Out of scope

- Moving any feature code into `modules/<feature>/`. That is PR-2 (vehicles) and PR-3 (bookings).
- Restructuring `packages/shared/`. Schema and validators already live in per-feature files.
- Adding `components/ui/` primitives to the module system. Those stay outside modules as design-system shared code.

Closes #<issue number if any>
EOF
)"
```

- [ ] **Step 15.3: Wait for CI to be green**

```bash
gh pr checks --watch
```

Expected: `test-and-build` passes. `db-drift` passes (no schema touched). CF deploy check is allowed to fail on PR branches per `CLAUDE.md`.

- [ ] **Step 15.4: Merge and clean up**

Do NOT auto-merge. This PR is the foundation; the owner merges it manually after review.

After merge:

```bash
cd /Users/jack/Dev/kuruma-rental
git worktree remove ../kuruma-feat-modules-pr1
git fetch origin main --prune
```

---

## Post-PR follow-ups (NOT part of PR-1)

After PR-1 lands, file GitHub issues for the next two plans:

1. `plan: PR-2 vehicles migration into modules/vehicles/`
2. `plan: PR-3 bookings migration into modules/bookings/`

Each gets its own plan document under `docs/superpowers/plans/` written against the post-PR-1 state of main.
