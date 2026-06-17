import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findDetachedFetchDefaults, scanRoots } from './lint-fetch-binding'

describe('findDetachedFetchDefaults', () => {
  test('flags a class field defaulted to the bare global fetch', () => {
    const src = '  constructor(\n    private readonly fetchFn: typeof fetch = fetch,\n  ) {}'
    expect(findDetachedFetchDefaults(src)).toEqual([2])
  })

  test('flags a function parameter defaulted to the bare global fetch', () => {
    const src = 'export async function proxy(\n  fetchImpl: typeof fetch = fetch,\n) {}'
    expect(findDetachedFetchDefaults(src)).toEqual([2])
  })

  test('flags `= fetch` when the closing paren is on the next line', () => {
    const src = 'function f(\n  fetchImpl: typeof fetch = fetch\n) {}'
    expect(findDetachedFetchDefaults(src)).toEqual([2])
  })

  test('flags the `= globalThis.fetch` / `= self.fetch` capture — same detached bug', () => {
    const src = ['a: typeof fetch = globalThis.fetch,', 'b: typeof fetch = self.fetch)'].join('\n')
    expect(findDetachedFetchDefaults(src)).toEqual([1, 2])
  })

  test('does NOT flag the bound form `= fetch.bind(globalThis)`', () => {
    const src =
      '    private readonly fetchFn: typeof fetch = fetch.bind(globalThis) as typeof fetch,'
    expect(findDetachedFetchDefaults(src)).toEqual([])
  })

  test('does NOT flag `= globalThis.fetch.bind(globalThis)` (bound, qualified)', () => {
    const src = 'fetchFn: typeof fetch = globalThis.fetch.bind(globalThis) as typeof fetch,'
    expect(findDetachedFetchDefaults(src)).toEqual([])
  })

  test('does NOT flag a real call through the injected fn', () => {
    const src = 'const response = await this.fetchFn(ENDPOINT, {})\nreturn fetchImpl(url, {})'
    expect(findDetachedFetchDefaults(src)).toEqual([])
  })

  test('does NOT flag a bare direct fetch call', () => {
    const src = 'const r = await fetch(url)'
    expect(findDetachedFetchDefaults(src)).toEqual([])
  })

  test('does NOT flag the pattern inside a line comment', () => {
    const src = '// historical: the default used to be = fetch, which broke on Workers'
    expect(findDetachedFetchDefaults(src)).toEqual([])
  })

  test('does NOT flag the pattern inside a block comment (line numbers preserved)', () => {
    const src = [
      '/**',
      ' * the old default: = fetch, broke on Workers',
      ' */',
      'const ok = 1',
    ].join('\n')
    expect(findDetachedFetchDefaults(src)).toEqual([])
  })

  test('does NOT flag the pattern inside a string literal', () => {
    const src = 'const msg = "change : typeof fetch = fetch, to a bound default"'
    expect(findDetachedFetchDefaults(src)).toEqual([])
  })

  test('reports every offending line in a multi-default source', () => {
    const src = [
      'a: typeof fetch = fetch,',
      'ok: typeof fetch = fetch.bind(globalThis),',
      'b: typeof fetch = fetch)',
    ].join('\n')
    expect(findDetachedFetchDefaults(src)).toEqual([1, 3])
  })

  // #892 follow-up: a TS cast must not let the unbound capture slip past — and
  // `as typeof fetch` already appears (correctly) on the bound form, so the
  // cast-without-bind shape is one copy-paste away.
  test('flags `= fetch as typeof fetch` — an unbound cast must not bypass the guard', () => {
    const src = '    private readonly fetchFn: typeof fetch = fetch as typeof fetch,'
    expect(findDetachedFetchDefaults(src)).toEqual([1])
  })

  test('flags a qualified unbound cast `= globalThis.fetch as typeof fetch`', () => {
    const src = 'fetchFn: typeof fetch = globalThis.fetch as typeof fetch,'
    expect(findDetachedFetchDefaults(src)).toEqual([1])
  })

  test('flags an unbound cast when the closing paren is on the next line', () => {
    const src = 'function f(\n  fetchImpl: typeof fetch = fetch as typeof fetch\n) {}'
    expect(findDetachedFetchDefaults(src)).toEqual([2])
  })

  test('flags the `= window.fetch` capture (DOM-typed web alias of the global)', () => {
    const src = [
      'a: typeof fetch = window.fetch,',
      'b: typeof fetch = window.fetch as typeof fetch)',
    ].join('\n')
    expect(findDetachedFetchDefaults(src)).toEqual([1, 2])
  })
})

describe('scanRoots', () => {
  let cwd: string
  const BAD = 'fetchFn: typeof fetch = fetch,'

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'lint-fetch-binding-'))
    const root = join(cwd, 'src')
    mkdirSync(join(root, 'tests'), { recursive: true })
    writeFileSync(join(root, 'service.ts'), BAD) // scanned -> violation
    writeFileSync(join(root, 'widget.tsx'), BAD) // .tsx scanned -> violation
    writeFileSync(join(root, 'edge.cts'), BAD) // .cts scanned -> violation
    writeFileSync(join(root, 'legacy.js'), BAD) // .js scanned -> violation
    writeFileSync(join(root, 'service.test.ts'), BAD) // excluded (real fetch ok in tests)
    writeFileSync(join(root, 'tests', 'helper.ts'), BAD) // excluded (tests/ dir)
    writeFileSync(join(root, 'clean.ts'), 'const ok = fetch.bind(globalThis)') // bound -> clean
  })

  afterAll(() => rmSync(cwd, { recursive: true, force: true }))

  test('reports prod .ts/.tsx/.cts/.js violations and skips tests + bound files', () => {
    const files = scanRoots(['src'], cwd)
      .map((v) => v.file)
      .sort()
    expect(files).toEqual(['src/edge.cts', 'src/legacy.js', 'src/service.ts', 'src/widget.tsx'])
  })

  test('returns the offending line number for each violation', () => {
    expect(scanRoots(['src'], cwd).every((v) => v.line === 1)).toBe(true)
  })

  test('silently skips a root that does not exist', () => {
    expect(scanRoots(['nope'], cwd)).toEqual([])
  })
})
