import { describe, expect, it } from 'vitest'
import { jpyAmount } from '../../src/validators/money'

// The message helper: pull the first issue's message off a failed safeParse so
// assertions pin the exact copy a form renders, not just success/failure.
function firstError(schema: ReturnType<typeof jpyAmount>, value: unknown): string {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('expected a validation failure')
  return result.error.issues[0]?.message ?? ''
}

describe('jpyAmount(label)', () => {
  it('accepts zero — a free promo / waived fee is a valid whole-yen amount', () => {
    expect(jpyAmount('Rate').safeParse(0)).toMatchObject({ success: true, data: 0 })
  })

  it('accepts a positive whole-yen amount', () => {
    expect(jpyAmount('Amount').safeParse(5000)).toMatchObject({ success: true, data: 5000 })
  })

  it('rejects a negative amount with the label-scoped message', () => {
    expect(firstError(jpyAmount('Rate'), -1)).toBe('Rate cannot be negative')
  })

  it('rejects a fractional yen with the label-scoped whole-yen message', () => {
    expect(firstError(jpyAmount('Rate'), 1500.5)).toBe('Rate must be a whole yen amount')
  })

  it('rejects a non-number', () => {
    expect(jpyAmount('Amount').safeParse('5000').success).toBe(false)
  })

  it('interpolates the label so each field reads naturally', () => {
    expect(firstError(jpyAmount('Amount'), -1)).toBe('Amount cannot be negative')
    expect(firstError(jpyAmount('Deductible'), 0.5)).toBe('Deductible must be a whole yen amount')
  })
})
