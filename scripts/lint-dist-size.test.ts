import { describe, expect, test } from 'bun:test'
import { measureGzip } from './lint-dist-size'

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('lint-dist-size', () => {
  test('totals the gzipped size of every file', () => {
    const report = measureGzip([
      { file: 'a.js', content: bytes('a'.repeat(2000)) },
      { file: 'b.css', content: bytes('b'.repeat(2000)) },
    ])
    expect(report.assets).toHaveLength(2)
    expect(report.totalGzipBytes).toBe(report.assets[0]!.gzipBytes + report.assets[1]!.gzipBytes)
    expect(report.totalGzipBytes).toBeGreaterThan(0)
  })

  test('flags over-budget when the gzipped total exceeds the cap', () => {
    const report = measureGzip([{ file: 'big.js', content: bytes('x'.repeat(100_000)) }], 10)
    expect(report.overBudget).toBe(true)
  })

  test('stays under budget for a small dist', () => {
    const report = measureGzip(
      [{ file: 'small.js', content: bytes('hello world') }],
      2 * 1024 * 1024,
    )
    expect(report.overBudget).toBe(false)
    expect(report.budgetBytes).toBe(2 * 1024 * 1024)
  })

  test('sorts assets largest-gzipped first for diagnosis', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `chunk${i}`).join('-')
    const report = measureGzip([
      { file: 'small.js', content: bytes('x'.repeat(8)) },
      { file: 'large.js', content: bytes(big) },
    ])
    expect(report.assets[0]!.file).toBe('large.js')
  })
})
