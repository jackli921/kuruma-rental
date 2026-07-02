import { describe, expect, it } from 'vitest'
import {
  createAddOnSchema,
  platformAdminCreateAddOnSchema,
  updateAddOnSchema,
} from '../../src/validators/add-on'

// A valid v4-shaped UUID (seedId output shape) — templateId is validated as uuid.
const TEMPLATE_ID = '366823c3-d8c0-4e82-a262-e6309728bd02'

function validInput() {
  return {
    templateId: TEMPLATE_ID,
    priceJpy: 1100,
  }
}

describe('createAddOnSchema', () => {
  it('accepts valid input with required fields only (templateId + price)', () => {
    const result = createAddOnSchema.safeParse(validInput())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.templateId).toBe(TEMPLATE_ID)
      expect(result.data.priceJpy).toBe(1100)
    }
  })

  it('rejects a missing templateId', () => {
    const result = createAddOnSchema.safeParse({ priceJpy: 1100 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-uuid templateId', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), templateId: 'child_seat' })
    expect(result.success).toBe(false)
  })

  it('drops the retired free-text name field', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), name: 'Baby seat' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).name).toBeUndefined()
    }
  })

  it('accepts a single-locale descriptionOverride bag', () => {
    const result = createAddOnSchema.safeParse({
      ...validInput(),
      descriptionOverride: { ja: 'オリジナルの説明' },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.descriptionOverride).toEqual({ ja: 'オリジナルの説明' })
  })

  it('accepts a null descriptionOverride (no override)', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), descriptionOverride: null })
    expect(result.success).toBe(true)
  })

  it('rejects an empty descriptionOverride object (no locale)', () => {
    const result = createAddOnSchema.safeParse({ ...validInput(), descriptionOverride: {} })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown-locale key in descriptionOverride', () => {
    const result = createAddOnSchema.safeParse({
      ...validInput(),
      descriptionOverride: { xx: 'nope' },
    })
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
    const result = createAddOnSchema.safeParse({ templateId: TEMPLATE_ID })
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
  it('accepts a partial update (priceJpy only)', () => {
    const result = updateAddOnSchema.safeParse({ priceJpy: 1800 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.priceJpy).toBe(1800)
  })

  it('accepts a descriptionOverride update', () => {
    const result = updateAddOnSchema.safeParse({ descriptionOverride: { en: 'Updated copy' } })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.descriptionOverride).toEqual({ en: 'Updated copy' })
  })

  it('accepts clearing the override with null', () => {
    const result = updateAddOnSchema.safeParse({ descriptionOverride: null })
    expect(result.success).toBe(true)
  })

  it('accepts an empty object', () => {
    const result = updateAddOnSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('still rejects a negative priceJpy on update', () => {
    const result = updateAddOnSchema.safeParse({ priceJpy: -5 })
    expect(result.success).toBe(false)
  })

  it('does not accept a templateId change on update (identity is fixed)', () => {
    const result = updateAddOnSchema.safeParse({ templateId: TEMPLATE_ID })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).templateId).toBeUndefined()
    }
  })
})
