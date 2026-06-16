import { describe, expect, test } from 'bun:test'
import { findDetachedFetchDefaults } from './lint-fetch-binding'

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

  test('does NOT flag the bound form `= fetch.bind(globalThis)`', () => {
    const src =
      '    private readonly fetchFn: typeof fetch = fetch.bind(globalThis) as typeof fetch,'
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

  test('reports every offending line in a multi-default source', () => {
    const src = [
      'a: typeof fetch = fetch,',
      'ok: typeof fetch = fetch.bind(globalThis),',
      'b: typeof fetch = fetch)',
    ].join('\n')
    expect(findDetachedFetchDefaults(src)).toEqual([1, 3])
  })
})
