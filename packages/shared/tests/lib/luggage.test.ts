import { describe, expect, test } from 'vitest'
import { LUGGAGE_SIZES, resolveLuggage } from '../../src/lib/luggage'

describe('LUGGAGE_SIZES', () => {
  test('is the standardized size enum, smallest to largest', () => {
    expect(LUGGAGE_SIZES).toEqual(['SMALL', 'MEDIUM', 'LARGE'])
  })
})

describe('resolveLuggage', () => {
  // Class default is always fully populated (the DB column is NOT NULL).
  const classDefault = { luggageCapacity: 2, luggageSize: 'MEDIUM' } as const

  test('uses the vehicle override when both fields are set', () => {
    expect(resolveLuggage({ luggageCapacity: 4, luggageSize: 'LARGE' }, classDefault)).toEqual({
      luggageCapacity: 4,
      luggageSize: 'LARGE',
    })
  })

  test('falls back to the class default per-field (count set, size blank)', () => {
    expect(resolveLuggage({ luggageCapacity: 4, luggageSize: null }, classDefault)).toEqual({
      luggageCapacity: 4,
      luggageSize: 'MEDIUM',
    })
  })

  test('falls back to the class default per-field (size set, count blank)', () => {
    expect(resolveLuggage({ luggageCapacity: null, luggageSize: 'SMALL' }, classDefault)).toEqual({
      luggageCapacity: 2,
      luggageSize: 'SMALL',
    })
  })

  test('falls back entirely to the class default when the vehicle has no override', () => {
    expect(resolveLuggage({ luggageCapacity: null, luggageSize: null }, classDefault)).toEqual({
      luggageCapacity: 2,
      luggageSize: 'MEDIUM',
    })
  })

  test('treats a zero-count override as an explicit value, not a fallback (?? not ||)', () => {
    expect(
      resolveLuggage({ luggageCapacity: 0, luggageSize: 'SMALL' }, classDefault).luggageCapacity,
    ).toBe(0)
  })
})
