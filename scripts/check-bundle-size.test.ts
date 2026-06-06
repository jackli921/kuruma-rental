import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  FIRST_LOAD_BUDGET_BYTES,
  checkBudget,
  formatKb,
  sharedFirstLoadFiles,
  sumBytes,
  totalChunkBytes,
} from './check-bundle-size'

const FIXTURE = 'scripts/__fixtures__/bundle'
const manifest = JSON.parse(readFileSync(`${FIXTURE}/build-manifest.json`, 'utf8'))

describe('check-bundle-size', () => {
  test('sharedFirstLoadFiles dedups root + polyfill JS, preserving order', () => {
    expect(sharedFirstLoadFiles(manifest)).toEqual([
      'static/chunks/root-a.js',
      'static/chunks/root-b.js',
      'static/chunks/polyfill.js',
    ])
  })

  test('sumBytes totals on-disk sizes of the shared first-load files', () => {
    // root-a 200 + root-b 150 + polyfill 100 (root-a counted once after dedup)
    expect(sumBytes(sharedFirstLoadFiles(manifest), FIXTURE)).toBe(450)
  })

  test('totalChunkBytes sums every static/chunks JS file, incl. non-first-load', () => {
    // 450 shared + route-x 50 (a chunk no route lists in first load)
    expect(totalChunkBytes(FIXTURE)).toBe(500)
  })

  test('checkBudget flags bytes strictly over budget (equal is allowed)', () => {
    expect(checkBudget(450, 450)).toEqual({ bytes: 450, budgetBytes: 450, overBudget: false })
    expect(checkBudget(451, 450).overBudget).toBe(true)
  })

  test('checkBudget defaults to the 500 kB first-load budget', () => {
    expect(FIRST_LOAD_BUDGET_BYTES).toBe(500 * 1024)
    expect(checkBudget(FIRST_LOAD_BUDGET_BYTES + 1).overBudget).toBe(true)
  })

  test('formatKb renders one-decimal kB', () => {
    expect(formatKb(450)).toBe('0.4 kB')
    expect(formatKb(500 * 1024)).toBe('500.0 kB')
  })
})
