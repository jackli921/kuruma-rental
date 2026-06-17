/**
 * Ban detached defaults to the global `fetch` in deployed runtime code (#887).
 *
 * On the Cloudflare Workers/Pages runtime the global `fetch` is a branded builtin
 * that must be called with `this === globalThis`. A parameter or field defaulted
 * to the bare identifier — `fetchFn: typeof fetch = fetch` — captures it detached;
 * calling it as `this.fetchFn(...)` (this = the instance) throws "Illegal
 * invocation" and every send/translate/geocode/proxy silently FAILS. Node/vitest
 * don't brand `fetch`, so this is invisible in CI and only bites the live runtime.
 * It already bit 4 sites; this guard keeps it from coming back.
 *
 * The fix: default to the shared `boundFetch` (`@kuruma/shared/lib/bound-fetch`)
 * instead of the bare global — it keeps `this === globalThis` and the injectable
 * test mock intact. An inline `fetch.bind(globalThis) as typeof fetch` is still
 * accepted (boundFetch is defined with it), but the import is the canonical fix.
 *
 * Scope = every DEPLOYED runtime surface (scan by runtime, not by package), and
 * production code only — `*.test.ts` and `tests/` legitimately pass a real fetch.
 *
 * Run: bun run scripts/lint-fetch-binding.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Deployed runtime surfaces: the API worker, the web SPA, the Pages Functions
// (OAuth/API proxy), and shared code bundled into both.
const RUNTIME_ROOTS = [
  'packages/api/src',
  'packages/web/src',
  'packages/web/functions',
  'packages/shared/src',
]

// A default initializer set to the bare global fetch: `= fetch` (optionally
// `globalThis.`/`self.`/`window.`-qualified — each captures it just as detached),
// with an OPTIONAL `as <type>` cast, followed by a `,` / `)` that closes the
// param, or end-of-line when the `)` is on the next line (a last param without a
// trailing comma). The `(?!\s*[.(])` right after `fetch` rejects the safe forms:
// `= fetch.bind(...)` (a `.`) and `= fetch(url)` (a `(`). A cast does NOT launder
// the bug — `= fetch as typeof fetch` is still an unbound capture (and that exact
// `as typeof fetch` shape already rides on the bound fix, one copy-paste away) —
// so the cast is matched and flagged unless `.bind` precedes it.
const DETACHED_FETCH_DEFAULT =
  /=\s*(?:globalThis\.|self\.|window\.)?fetch\b(?!\s*[.(])(?:\s+as\s+[^,)]+?)?\s*(?:[,)]|$)/

/**
 * Blanks line comments, block comments, and string/template literals while
 * preserving newlines (so line numbers stay accurate), so a `= fetch,` mentioned
 * in prose or a string literal is never mistaken for code. Template `${}`
 * interpolations are blanked too — a detached-fetch default never lives there.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

/** 1-based line numbers whose line opens a detached `= fetch` default. */
export function findDetachedFetchDefaults(source: string): number[] {
  const offending: number[] = []
  const lines = stripCommentsAndStrings(source).split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (DETACHED_FETCH_DEFAULT.test(lines[i] ?? '')) offending.push(i + 1)
  }
  return offending
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'tests' || entry === '__tests__') continue
      files.push(...collectTsFiles(full))
    } else if (/\.(c|m)?[jt]sx?$/.test(entry) && !/\.test\.(c|m)?[jt]sx?$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

export interface Violation {
  file: string
  line: number
}

export function scanRoots(roots: readonly string[], cwd: string): Violation[] {
  const violations: Violation[] = []
  for (const root of roots) {
    const abs = join(cwd, root)
    let files: string[]
    try {
      files = collectTsFiles(abs)
    } catch {
      continue // a root may not exist in every checkout — skip it
    }
    for (const file of files) {
      for (const line of findDetachedFetchDefaults(readFileSync(file, 'utf8'))) {
        violations.push({ file: relative(cwd, file), line })
      }
    }
  }
  return violations
}

function main() {
  const cwd = new URL('..', import.meta.url).pathname
  const violations = scanRoots(RUNTIME_ROOTS, cwd)
  if (violations.length > 0) {
    console.error(`[lint-fetch-binding] ${violations.length} detached \`fetch\` default(s) found:`)
    for (const v of violations) console.error(`  - ${v.file}:${v.line}`)
    console.error(
      '\nThe global fetch must be called with this===globalThis on CF Workers/Pages.\n' +
        "Import the shared safe default: `import { boundFetch } from '@kuruma/shared/lib/bound-fetch'`\n" +
        'then change `: typeof fetch = fetch` to `= boundFetch`.',
    )
    process.exit(1)
  }
  console.log('[lint-fetch-binding] no detached fetch defaults')
}

if (import.meta.main) {
  main()
}
