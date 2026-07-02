import { describe, expect, it } from 'vitest'
import { pgConstraintName, pgErrorCode } from '../src/pg-errors'

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

describe('pgConstraintName (#1362 driver parity)', () => {
  // postgres-js (the integration test driver) + the in-memory repos expose the
  // violated constraint as `constraint_name`. This is what the suite has always
  // exercised; it must stay green.
  it('extracts constraint_name (postgres-js / in-memory repo style)', () => {
    const err = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint_name: 'payment_events_one_success_per_booking',
    })
    expect(pgConstraintName(err)).toBe('payment_events_one_success_per_booking')
  })

  // PRODUCTION runs the Neon drivers (@neondatabase/serverless HTTP + WebSocket),
  // which — like node-postgres — expose the name on `.constraint`, NOT
  // `.constraint_name`. This is the shape that silently returned null in prod.
  it('extracts constraint from a Neon-driver error (.constraint)', () => {
    const err = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint: 'payment_events_one_success_per_booking',
    })
    expect(pgConstraintName(err)).toBe('payment_events_one_success_per_booking')
  })

  it('extracts constraint from a drizzle-wrapped Neon error (err.cause.constraint)', () => {
    const cause = Object.assign(new Error('inner'), {
      code: '23505',
      constraint: 'bookings_no_overlap',
    })
    const err = new Error('Failed query')
    ;(err as unknown as { cause: Error }).cause = cause
    expect(pgConstraintName(err)).toBe('bookings_no_overlap')
  })

  it('extracts a camelCase constraintName defensively', () => {
    const err = Object.assign(new Error('dup'), { constraintName: 'vehicle_blocks_no_overlap' })
    expect(pgConstraintName(err)).toBe('vehicle_blocks_no_overlap')
  })

  it('returns null when no constraint field exists or input is not an object', () => {
    expect(pgConstraintName(new Error('plain'))).toBeNull()
    expect(pgConstraintName(null)).toBeNull()
    expect(pgConstraintName('nope')).toBeNull()
    expect(pgConstraintName(Object.assign(new Error('x'), { constraint: 123 }))).toBeNull()
  })
})
