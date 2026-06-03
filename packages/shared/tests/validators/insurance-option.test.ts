import { describe, expect, it } from 'vitest'
import {
  createInsuranceOptionSchema,
  platformAdminCreateInsuranceOptionSchema,
  updateInsuranceOptionSchema,
} from '../../src/validators/insurance-option'

function validInput() {
  return {
    name: 'Standard Cover',
    dailyPriceJpy: 1500,
  }
}

describe('createInsuranceOptionSchema', () => {
  it('accepts valid input with required fields only', () => {
    const result = createInsuranceOptionSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Standard Cover')
      expect(result.data.dailyPriceJpy).toBe(1500)
    }
  })

  it('trims and rejects an empty name', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), name: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), name: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('accepts an optional description', () => {
    const result = createInsuranceOptionSchema.safeParse({
      ...validInput(),
      description: 'Covers collision damage waiver.',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.description).toBe('Covers collision damage waiver.')
  })

  it('rejects a description over 2000 chars', () => {
    const result = createInsuranceOptionSchema.safeParse({
      ...validInput(),
      description: 'a'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects a negative dailyPriceJpy', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), dailyPriceJpy: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-integer dailyPriceJpy', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), dailyPriceJpy: 1500.5 })
    expect(result.success).toBe(false)
  })

  it('accepts a zero dailyPriceJpy (free option)', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), dailyPriceJpy: 0 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.dailyPriceJpy).toBe(0)
  })

  it('requires dailyPriceJpy', () => {
    const result = createInsuranceOptionSchema.safeParse({ name: 'No price' })
    expect(result.success).toBe(false)
  })

  it('accepts a non-negative deductibleJpy', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), deductibleJpy: 150000 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.deductibleJpy).toBe(150000)
  })

  it('rejects a negative deductibleJpy', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), deductibleJpy: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-integer deductibleJpy', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), deductibleJpy: 100.5 })
    expect(result.success).toBe(false)
  })

  it('accepts a null deductibleJpy (full cover, no deductible)', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), deductibleJpy: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.deductibleJpy).toBeNull()
  })

  it('does not accept an operatorId in the operator-caller schema', () => {
    const result = createInsuranceOptionSchema.safeParse({ ...validInput(), operatorId: 'op_x' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).operatorId).toBeUndefined()
    }
  })
})

describe('platformAdminCreateInsuranceOptionSchema', () => {
  it('requires operatorId', () => {
    const result = platformAdminCreateInsuranceOptionSchema.safeParse(validInput())
    expect(result.success).toBe(false)
  })

  it('accepts when operatorId is present', () => {
    const result = platformAdminCreateInsuranceOptionSchema.safeParse({
      ...validInput(),
      operatorId: 'op_best_car_rental',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.operatorId).toBe('op_best_car_rental')
  })

  it('rejects an empty operatorId', () => {
    const result = platformAdminCreateInsuranceOptionSchema.safeParse({
      ...validInput(),
      operatorId: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('updateInsuranceOptionSchema', () => {
  it('accepts a partial update', () => {
    const result = updateInsuranceOptionSchema.safeParse({ name: 'Premium Cover' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Premium Cover')
  })

  it('accepts an empty object', () => {
    const result = updateInsuranceOptionSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('still rejects a negative dailyPriceJpy on update', () => {
    const result = updateInsuranceOptionSchema.safeParse({ dailyPriceJpy: -5 })
    expect(result.success).toBe(false)
  })

  it('still rejects a negative deductibleJpy on update', () => {
    const result = updateInsuranceOptionSchema.safeParse({ deductibleJpy: -5 })
    expect(result.success).toBe(false)
  })

  it('accepts a null deductibleJpy on update', () => {
    const result = updateInsuranceOptionSchema.safeParse({ deductibleJpy: null })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.deductibleJpy).toBeNull()
  })
})
