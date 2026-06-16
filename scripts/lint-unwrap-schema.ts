/**
 * Ratcheting lint: web API clients must pass a Zod `schema` to `unwrap()` so the
 * network seam is runtime-validated, not a phantom `T` cast (#711). Schemaless
 * `unwrap(res)` / `unwrap<T>(res)` calls are unvalidated debt; this guard keeps
 * the count monotonically decreasing.
 *
 * Two failure modes (see `reconcile`):
 *  - a schemaless call appears OUTSIDE the allow-list -> new debt, fail.
 *  - an allow-listed file drops below its recorded count -> migrated, the list
 *    must shrink (the ratchet only goes down).
 *
 * The allow-list is seeded with today's sanctioned deferrals: the admin revenue
 * (#744) and payment-anomalies clients, whose API responses aren't schema-modelled
 * yet. Migrate one and you MUST decrement/remove its entry here, or CI fails.
 *
 * Limitation: the source scanner is lexical (it strips comments/strings, then
 * balances brackets). It does not handle `unwrap` inside `${}` template
 * interpolation or inside regex literals — neither occurs in the web clients.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const VITE_DIR = 'packages/web/src/vite'

/**
 * Files permitted to contain schemaless `unwrap()` calls, with their exact count.
 * When this empties, delete the count machinery and collapse the rule to a flat
 * "no schemaless unwrap anywhere" check — the invariant it's ratcheting toward.
 */
const ALLOW: Record<string, number> = {
  'admin/revenue/api.ts': 1,
  'admin/anomalies/api.ts': 1,
}

/**
 * Blanks line/block comments and string/template literals so an `unwrap(` token
 * mentioned in prose or a string is never mistaken for a call.
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
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < n) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch)

/**
 * Counts the non-empty, comma-separated top-level arguments of the call whose
 * `(` is at `open`. A trailing comma yields no extra argument, so `f(a,)` is
 * arity 1 — not 2. Used to tell `unwrap(res)` (schemaless) from
 * `unwrap(res, schema)` (validated).
 */
function topLevelArity(code: string, open: number): number {
  let depth = 1
  let args = 0
  let segmentHasContent = false
  let j = open + 1
  while (j < code.length && depth > 0) {
    const ch = code[j]
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      segmentHasContent = true
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) break
      segmentHasContent = true
    } else if (ch === ',' && depth === 1) {
      if (segmentHasContent) args++
      segmentHasContent = false
    } else if (!isSpace(ch)) {
      segmentHasContent = true
    }
    j++
  }
  if (segmentHasContent) args++
  return args
}

/**
 * Counts `unwrap(...)` calls that pass no Zod schema (fewer than two arguments).
 * Skips an optional `<...>` generic type-argument list before the call, and
 * ignores member access (`x.unwrap(...)`) since only the free `unwrap` helper
 * carries the schema contract.
 */
export function countSchemalessUnwraps(source: string): number {
  const code = stripCommentsAndStrings(source)
  const re = /\bunwrap\b/g
  let count = 0
  let m: RegExpExecArray | null = re.exec(code)
  while (m !== null) {
    if (code[m.index - 1] === '.') {
      m = re.exec(code)
      continue
    }
    let j = m.index + 'unwrap'.length
    while (isSpace(code[j])) j++
    if (code[j] === '<') {
      let angle = 0
      while (j < code.length) {
        if (code[j] === '<') angle++
        else if (code[j] === '>') {
          angle--
          if (angle === 0) {
            j++
            break
          }
        }
        j++
      }
      while (isSpace(code[j])) j++
    }
    if (code[j] === '(' && topLevelArity(code, j) < 2) count++
    m = re.exec(code)
  }
  return count
}

/**
 * Compares observed schemaless-call counts per file against the allow-list and
 * returns a violation message per discrepancy (empty array = pass).
 */
export function reconcile(actual: Record<string, number>, allow: Record<string, number>): string[] {
  const messages: string[] = []
  for (const [file, count] of Object.entries(actual)) {
    if (count <= 0) continue
    const expected = allow[file]
    if (expected === undefined) {
      messages.push(
        `${file}: ${count} schemaless unwrap() call(s) but the file is not on the allow-list. Pass a Zod schema to unwrap(), or add it to ALLOW if intentionally deferred.`,
      )
    } else if (count > expected) {
      messages.push(
        `${file}: expected ${expected} schemaless unwrap() call(s) but found ${count}. New unvalidated debt — validate the added call(s).`,
      )
    }
  }
  for (const [file, expected] of Object.entries(allow)) {
    const count = actual[file] ?? 0
    if (count < expected) {
      messages.push(
        `${file}: allow-list expects ${expected} schemaless unwrap() call(s) but found ${count}. This file was migrated — decrement or remove its ALLOW entry (the ratchet only shrinks).`,
      )
    }
  }
  return messages
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((p) => p.endsWith('.ts') || p.endsWith('.tsx'))
    .map((p) => join(dir, p))
}

function scanFiles(dir: string, files: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of files) {
    const n = countSchemalessUnwraps(readFileSync(file, 'utf-8'))
    if (n > 0) counts[relative(dir, file)] = n
  }
  return counts
}

if (import.meta.main) {
  // Fail closed: an empty scan would otherwise pass vacuously and hide that the
  // ratchet stopped looking at anything (e.g. a moved tree).
  const sourceFiles = listSourceFiles(VITE_DIR)
  if (sourceFiles.length === 0) {
    console.error(
      `lint-unwrap-schema: found 0 source files under ${VITE_DIR} — refusing to pass vacuously.`,
    )
    process.exit(1)
  }
  const actual = scanFiles(VITE_DIR, sourceFiles)
  const messages = reconcile(actual, ALLOW)
  if (messages.length > 0) {
    console.error('Unwrap-schema ratchet violations:\n')
    for (const msg of messages) console.error(`  ${msg}`)
    console.error('\nWeb API clients must pass a Zod schema to unwrap() (#711/#784).')
    process.exit(1)
  }
  const total = Object.values(actual).reduce((a, b) => a + b, 0)
  console.log(
    `unwrap-schema ratchet passed (${total} allow-listed schemaless call(s) across ${Object.keys(actual).length} file(s))`,
  )
}
