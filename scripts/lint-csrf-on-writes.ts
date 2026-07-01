// ENFORCES: every web cookie WRITE echoes the session CSRF token (#1304, #1325).
// SSOT: code-only — enforced by packages/api/src/middleware/csrf.ts; no written rule doc yet (#1325).
/**
 * Ban cookie writes that omit the `X-CSRF-Token` header (#1304).
 *
 * The API mounts a global CSRF guard (`app.use('*', csrf())`, `middleware/csrf.ts`):
 * any state-changing, cookie-bearing request whose headers lack a matching
 * `X-CSRF-Token` is rejected with 403 "CSRF token mismatch". The web SPA has no
 * shared write helper — each `packages/web/src/vite/<feature>/api.ts` hand-rolls
 * its `fetch(url, { method, credentials: 'include', headers: {...} })`, so a new
 * module can (and did: operator-fleet + operator-classes, #1304) ship a write that
 * forgets the header. `tsc` and the unit tests — which mock each module's `api.ts`
 * — stay green; only a real-API/E2E request surfaces the 403. This guard catches it
 * statically, in the spirit of `lint-fetch-binding.ts` (#887) and #1289.
 *
 * A "cookie write" here = a `fetch(...)` whose options object sets
 * `credentials: 'include'` AND a mutating `method` (a `'POST'|'PUT'|'PATCH'|'DELETE'`
 * literal, or the `method` shorthand a write helper forwards). Such a call must
 * thread the token — either the literal `'X-CSRF-Token'` header inline, or the
 * canonical `csrfToken` identifier (some modules build headers with a
 * `jsonHeaders(csrfToken)` helper). Credentialed GET reads (no `method`) are
 * untouched. The token variable is `csrfToken` everywhere (from
 * `useSession().data?.csrfToken`); this is a regression guard on that convention,
 * not an interprocedural proof — a write that stuffs the token somewhere other than
 * the request headers would slip past, but nothing does that.
 *
 * Run: bun run scripts/lint-csrf-on-writes.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// The web SPA is the only cookie-write caller; the API guards, it does not call.
const WRITE_ROOTS = ['packages/web/src']

const FETCH_CALL = /\bfetch\s*\(/g
const CREDENTIALED = /credentials\s*:\s*['"]include['"]/
const LITERAL_WRITE = /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i
// A write helper forwarding a `method` param as an object shorthand: `{ method, ... }`.
const SHORTHAND_WRITE = /[{,]\s*method\s*[,}]/
const HAS_CSRF = /['"]x-csrf-token['"]/i
// The canonical token identifier — covers `headers: jsonHeaders(csrfToken)`, where
// the literal header name lives in the helper rather than the fetch call itself.
const HAS_TOKEN_REF = /\bcsrfToken\b/

/**
 * Splits a source into two length-aligned views. `code` blanks comments AND string
 * interiors (so brackets/`fetch(` inside strings never miscount); `kept` blanks only
 * comments, leaving string literals intact so `'POST'` / `'X-CSRF-Token'` stay
 * searchable. Newlines are preserved in both, so line numbers stay accurate.
 */
export function splitSource(source: string): { code: string; kept: string } {
  const code: string[] = []
  const kept: string[] = []
  const push = (a: string, b: string): void => {
    code.push(a)
    kept.push(b)
  }
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i] ?? ''
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        push(' ', ' ')
        i++
      }
      continue
    }
    if (c === '/' && next === '*') {
      push(' ', ' ')
      push(' ', ' ')
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        const ch = source[i] === '\n' ? '\n' : ' '
        push(ch, ch)
        i++
      }
      if (i < n) {
        push(' ', ' ')
        push(' ', ' ')
        i += 2
      }
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      push(c, c) // opening delimiter, kept in both
      i++
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') {
          const a = source[i] ?? ''
          const b = source[i + 1]
          push(' ', a === '\n' ? '\n' : a)
          if (b !== undefined) push(' ', b === '\n' ? '\n' : b)
          i += 2
          continue
        }
        const ch = source[i] ?? ''
        const nl = ch === '\n'
        push(nl ? '\n' : ' ', nl ? '\n' : ch)
        i++
      }
      if (i < n) {
        push(c, c) // closing delimiter
        i++
      }
      continue
    }
    push(c, c)
    i++
  }
  return { code: code.join(''), kept: kept.join('') }
}

/** Index of the `)` that closes the `(` at `openIdx`, or -1. Operates on `code`. */
function matchParen(code: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 1-based line numbers of `fetch(` cookie writes that omit `X-CSRF-Token`. */
export function findCsrfViolations(source: string): number[] {
  const { code, kept } = splitSource(source)
  const offending: number[] = []
  for (const match of code.matchAll(FETCH_CALL)) {
    const start = match.index
    const openParen = start + match[0].length - 1
    const close = matchParen(code, openParen)
    if (close < 0) continue
    const segment = kept.slice(openParen, close + 1)
    if (!CREDENTIALED.test(segment)) continue
    const isWrite = LITERAL_WRITE.test(segment) || SHORTHAND_WRITE.test(segment)
    if (!isWrite) continue
    if (HAS_CSRF.test(segment) || HAS_TOKEN_REF.test(segment)) continue
    offending.push(code.slice(0, start).split('\n').length)
  }
  return offending
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'tests' || entry === '__tests__') continue
      files.push(...collectSourceFiles(full))
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
      files = collectSourceFiles(abs)
    } catch {
      continue // a root may not exist in every checkout — skip it
    }
    for (const file of files) {
      for (const line of findCsrfViolations(readFileSync(file, 'utf8'))) {
        violations.push({ file: relative(cwd, file), line })
      }
    }
  }
  return violations
}

function main(): void {
  const cwd = new URL('..', import.meta.url).pathname
  const violations = scanRoots(WRITE_ROOTS, cwd)
  if (violations.length > 0) {
    console.error(
      `[lint-csrf-on-writes] ${violations.length} cookie write(s) missing X-CSRF-Token:`,
    )
    for (const v of violations) console.error(`  - ${v.file}:${v.line}`)
    console.error(
      '\nThe API CSRF guard 403s any cookie write without a matching token.\n' +
        "Thread the session token into the request headers: `'X-CSRF-Token': csrfToken`\n" +
        '(csrfToken from `useSession().data?.csrfToken`), mirroring operator-fees/api.ts.',
    )
    process.exit(1)
  }
  console.log('[lint-csrf-on-writes] no cookie writes missing X-CSRF-Token')
}

if (import.meta.main) {
  main()
}
