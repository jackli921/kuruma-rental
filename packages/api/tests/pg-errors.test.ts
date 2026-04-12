import { describe, expect, it } from 'vitest'
import { pgErrorCode } from '../src/pg-errors'

describe('pgErrorCode', () => {
  it('extracts code from a raw PG error (in-memory repo style)', () => {
    const err = Object.assign(new Error('exclusion'), { code: '23P01' })
    expect(pgErrorCode(err)).toBe('23P01')
  })

  it('extracts code from drizzle-wrapped error (err.cause.code)', () => {
    const cause = Object.assign(new Error('PG error'), { code: '23P01' })
    const err = new Error('Failed query')
    ;(err as unknown as { cause: Error }).cause = cause
    expect(pgErrorCode(err)).toBe('23P01')
  })

  it('prefers err.code over err.cause.code when both exist', () => {
    const cause = Object.assign(new Error('inner'), { code: '23505' })
    const err = Object.assign(new Error('outer'), { code: '23P01' })
    ;(err as unknown as { cause: Error }).cause = cause
    expect(pgErrorCode(err)).toBe('23P01')
  })

  it('returns null for null input', () => {
    expect(pgErrorCode(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(pgErrorCode(undefined)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(pgErrorCode('string')).toBeNull()
    expect(pgErrorCode(42)).toBeNull()
  })

  it('returns null when code is not a string', () => {
    const err = Object.assign(new Error('bad'), { code: 123 })
    expect(pgErrorCode(err)).toBeNull()
  })

  it('returns null when neither err.code nor err.cause.code exist', () => {
    const err = new Error('plain error')
    expect(pgErrorCode(err)).toBeNull()
  })
})
