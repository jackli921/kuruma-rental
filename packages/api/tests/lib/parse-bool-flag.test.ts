import { describe, expect, it } from 'vitest'
import { parseBoolFlag } from '../../src/lib/parse-bool-flag'

describe('parseBoolFlag', () => {
  it('treats only "true" and "1" as true', () => {
    expect(parseBoolFlag('true')).toBe(true)
    expect(parseBoolFlag('1')).toBe(true)
  })

  it('treats every other value (including undefined) as false', () => {
    expect(parseBoolFlag(undefined)).toBe(false)
    expect(parseBoolFlag('')).toBe(false)
    expect(parseBoolFlag('false')).toBe(false)
    expect(parseBoolFlag('0')).toBe(false)
    // Case-sensitive on purpose — a stray "TRUE" must not silently flip a
    // safety-critical gate on.
    expect(parseBoolFlag('TRUE')).toBe(false)
    expect(parseBoolFlag('yes')).toBe(false)
  })
})
