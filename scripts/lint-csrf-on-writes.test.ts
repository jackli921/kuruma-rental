import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCsrfViolations, scanRoots } from './lint-csrf-on-writes'

// A cookie write = `fetch(..., { method: <mutating>, credentials: 'include', ... })`.
// The global CSRF guard 403s any such request whose headers omit `X-CSRF-Token`
// (packages/api middleware/csrf.ts). This scanner catches the miss statically
// (the class of bug #1304: operator-fleet/-classes shipped writes without it).
const lines = (...ls: string[]): string => ls.join('\n')

describe('findCsrfViolations', () => {
  test('flags a literal POST cookie write missing X-CSRF-Token (the #1304 bug)', () => {
    const src = lines(
      'async function create(csrfToken: string) {',
      '  const res = await fetch(`${base}/vehicles`, {',
      "    method: 'POST',",
      "    credentials: 'include',",
      "    headers: { 'Content-Type': 'application/json' },",
      '    body: JSON.stringify(data),',
      '  })',
      '}',
    )
    expect(findCsrfViolations(src)).toEqual([2])
  })

  test('does NOT flag when X-CSRF-Token is present', () => {
    const src = lines(
      '  const res = await fetch(`${base}/vehicles`, {',
      "    method: 'POST',",
      "    credentials: 'include',",
      "    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('does NOT flag a credentialed GET read (no method key)', () => {
    const src = lines(
      '  const res = await fetch(`${base}/dashboard/overview`, {',
      "    credentials: 'include',",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('flags the `method,` shorthand write helper missing the token (the fleet writeJson shape)', () => {
    const src = lines(
      '  const res = await fetch(`${base}${path}`, {',
      '    method,',
      "    credentials: 'include',",
      "    headers: { 'Content-Type': 'application/json' },",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([1])
  })

  test('does NOT flag the `method,` shorthand helper when it threads the token', () => {
    const src = lines(
      '  const res = await fetch(`${base}${path}`, {',
      '    method,',
      "    credentials: 'include',",
      "    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('flags a dynamic `method: verb` cookie write missing the token', () => {
    const src = lines(
      '  const res = await fetch(`${base}${path}`, {',
      '    method: verb,',
      "    credentials: 'include',",
      "    headers: { 'Content-Type': 'application/json' },",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([1])
  })

  test('does NOT flag a dynamic `method: verb` write that threads the token', () => {
    const src = lines(
      '  const res = await fetch(`${base}${path}`, {',
      '    method: verb,',
      "    credentials: 'include',",
      '    headers: jsonHeaders(csrfToken),',
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('does NOT flag a write whose headers come from a helper threaded csrfToken', () => {
    // admin/operators + messaging spell it `headers: jsonHeaders(csrfToken)` — the
    // literal 'X-CSRF-Token' lives in the helper, but the token is demonstrably threaded.
    const src = lines(
      '  const res = await fetch(`${base}/admin/operators`, {',
      "    method: 'POST',",
      "    credentials: 'include',",
      '    headers: jsonHeaders(csrfToken),',
      '    body: JSON.stringify(body),',
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('does NOT flag a mutating fetch that is NOT a cookie write (no credentials: include)', () => {
    const src =
      "  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })"
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('flags a DELETE cookie write missing the token', () => {
    const src = lines(
      '  const res = await fetch(`${getApiBaseUrl()}/vehicles/${encodeURIComponent(id)}`, {',
      "    method: 'DELETE',",
      "    credentials: 'include',",
      "    headers: { 'X-Trace': traceId },",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([1])
  })

  test('bracket-matching survives template-literal URLs with nested parens', () => {
    const src = lines(
      '  const res = await fetch(`${getApiBaseUrl()}/vehicles/${encodeURIComponent(id)}`, {',
      "    method: 'DELETE',",
      "    credentials: 'include',",
      "    headers: { 'X-CSRF-Token': csrfToken },",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('does NOT flag a write pattern that lives only inside a comment', () => {
    const src = lines(
      "// old bug: fetch(url, { method: 'POST', credentials: 'include' }) shipped no token",
      'const ok = 1',
    )
    expect(findCsrfViolations(src)).toEqual([])
  })

  test('reports every offending fetch in a multi-write module', () => {
    const src = lines(
      '  await fetch(a, {', // line 1 -> violation
      "    method: 'POST',",
      "    credentials: 'include',",
      '  })',
      '  await fetch(b, {', // line 5 -> clean (has token)
      "    method: 'PATCH',",
      "    credentials: 'include',",
      "    headers: { 'X-CSRF-Token': t },",
      '  })',
      '  await fetch(c, {', // line 10 -> violation
      "    method: 'DELETE',",
      "    credentials: 'include',",
      '  })',
    )
    expect(findCsrfViolations(src)).toEqual([1, 10])
  })
})

describe('scanRoots', () => {
  let cwd: string
  const BAD = lines(
    'export async function create(csrfToken: string) {',
    '  return fetch(url, {',
    "    method: 'POST',",
    "    credentials: 'include',",
    '  })',
    '}',
  )
  const GOOD = lines(
    'export async function read() {',
    "  return fetch(url, { credentials: 'include' })",
    '}',
  )

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'lint-csrf-'))
    const root = join(cwd, 'packages', 'web', 'src')
    mkdirSync(join(root, 'tests'), { recursive: true })
    writeFileSync(join(root, 'api.ts'), BAD) // scanned -> violation
    writeFileSync(join(root, 'widget.tsx'), BAD) // .tsx scanned -> violation
    writeFileSync(join(root, 'read.ts'), GOOD) // credentialed read -> clean
    writeFileSync(join(root, 'api.test.ts'), BAD) // excluded (tests mock the client)
    writeFileSync(join(root, 'tests', 'helper.ts'), BAD) // excluded (tests/ dir)
  })

  afterAll(() => rmSync(cwd, { recursive: true, force: true }))

  test('reports prod .ts/.tsx violations and skips tests + credentialed reads', () => {
    const files = scanRoots(['packages/web/src'], cwd)
      .violations.map((v) => v.file)
      .sort()
    expect(files).toEqual(['packages/web/src/api.ts', 'packages/web/src/widget.tsx'])
  })

  test('returns the offending fetch line number', () => {
    const v = scanRoots(['packages/web/src'], cwd).violations.find((x) => x.file.endsWith('api.ts'))
    expect(v?.line).toBe(2)
  })

  test('counts every prod file scanned (fail-closed signal)', () => {
    // BAD api.ts + BAD widget.tsx + GOOD read.ts = 3 prod files; tests excluded.
    expect(scanRoots(['packages/web/src'], cwd).scanned).toBe(3)
  })

  test('a root that does not exist yields no violations AND zero scanned', () => {
    const result = scanRoots(['nope'], cwd)
    expect(result.violations).toEqual([])
    expect(result.scanned).toBe(0)
  })
})
