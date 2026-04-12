#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { Glob } from 'bun'

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
    // Use trimEnd to match `wc -l` semantics: trailing newline doesn't count as an extra line.
    const lines = content.trimEnd().split('\n').length
    const rule = capForFile(file)
    if (lines > rule.cap) {
      issues.push({ file, lines, cap: rule.cap, level: 'error' })
    } else if (rule.soft !== null && lines > rule.soft) {
      issues.push({ file, lines, cap: rule.soft, level: 'warn' })
    }
  }
  return issues
}

const ROOTS = ['packages/api/src', 'packages/web/src', 'packages/shared/src']

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
    stream.write(`[lint-file-size] ${tag} ${issue.file}: ${issue.lines} lines (cap ${issue.cap})\n`)
    if (issue.level === 'error') errors++
    else warnings++
  }

  if (errors > 0) {
    process.stderr.write(`[lint-file-size] ${errors} error(s), ${warnings} warning(s)\n`)
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
