import { describe, expect, it } from 'vitest'
import {
  createAddOnSchema,
  platformAdminCreateAddOnSchema,
  updateAddOnSchema,
} from '../../src/validators/add-on'

function validInput() {
  return {
    name: 'Baby seat',
    priceJpy: 1100,
  }
}

describe('createAddOnSchema', () => {
  it('accepts valid input with required fields only', () => {
    const result = createAddOnSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Baby seat')
      expect(result.data.priceJpy).toBe(1100)
    }
  })

  it('trims and rejects an empty name', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), name: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), name: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('accepts an optional description', () => {
    const result = createAddOnSchema.safeParse({
      ...validInput(),
      description: 'Rear-facing infant seat, 0-12 months.',
    })
    expect(result.success).toBe(true)
    if (result.success)
      expect(result.data.description).toBe('Rear-facing infant seat, 0-12 months.')
  })

  it('rejects a description over 2000 chars', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), description: 'a'.repeat(2001) })
    expect(result.success).toBe(false)
  })

  it('rejects a negative priceJpy', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), priceJpy: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-integer priceJpy', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), priceJpy: 1100.5 })
    expect(result.success).toBe(false)
  })

  it('accepts a zero priceJpy (free add-on)', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), priceJpy: 0 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.priceJpy).toBe(0)
  })

  it('requires priceJpy', () => {
    const result = createAddOnSchema.safeParse({ name: 'No price' })
    expect(result.success).toBe(false)
  })

  it('does not accept an operatorId in the operator-caller schema', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), operatorId: 'op_x' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).operatorId).toBeUndefined()
    }
  })
})

describe('platformAdminCreateAddOnSchema', () => {
  it('requires operatorId', () => {
    const result = platformAdminCreateAddOnSchema.safeParse(validInput())
    expect(result.success).toBe(false)
  })

  it('accepts when operatorId is present', () => {
    const result = platformAdminCreateAddOnSchema.safeParse({
      ...validInput(),
      operatorId: 'op_best_car_rental',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.operatorId).toBe('op_best_car_rental')
  })

  it('rejects an empty operatorId', () => {
    const result = platformAdminCreateAddOnSchema.safeParse({ ...validInput(), operatorId: '' })
    expect(result.success).toBe(false)
  })
})

describe('updateAddOnSchema', () => {
  it('accepts a partial update', () => {
    const result = updateAddOnSchema.safeParse({ name: 'Junior seat' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Junior seat')
  })

  it('accepts an empty object', () => {
    const result = updateAddOnSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('still rejects a negative priceJpy on update', () => {
    const result = updateAddOnSchema.safeParse({ priceJpy: -5 })
    expect(result.success).toBe(false)
  })
})
