import { describe, expect, it } from 'vitest'
import {
  createAddOnSchema,
  platformAdminCreateAddOnSchema,
  updateAddOnSchema,
} from '../../src/validators/add-on'

// A valid v4-shaped UUID (seedId output shape) — templateId is validated as uuid.
const TEMPLATE_ID = '366823c3-d8c0-4e82-a262-e6309728bd02'
// A self-authored name bundle: LocalizedText (en required, ja/zh optional).
const NAME_I18N = { en: 'GPS unit', ja: 'GPS ユニット', zh: 'GPS 装置' }

function validInput() {
  return {
    templateId: TEMPLATE_ID,
    priceJpy: 1100,
  }
}

function selfAuthoredInput() {
  return {
    nameI18n: NAME_I18N,
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

  it('rejects when neither a template nor a custom name is provided', () => {
    const result = createAddOnSchema.safeParse({ priceJpy: 1100 })
    expect(result.success).toBe(false)
  })

  it('accepts a self-authored item (nameI18n bundle, no templateId)', () => {
    const result = createAddOnSchema.safeParse(selfAuthoredInput())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.nameI18n).toEqual(NAME_I18N)
      expect(result.data.templateId).toBeUndefined()
    }
  })

  it('rejects an item carrying BOTH a templateId and a nameI18n (ambiguous identity)', () => {
    const result = createAddOnSchema.safeParse({
      templateId: TEMPLATE_ID,
      nameI18n: NAME_I18N,
      priceJpy: 1100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a self-authored nameI18n missing the required en floor', () => {
    const result = createAddOnSchema.safeParse({
      nameI18n: { ja: 'GPS ユニット' },
      priceJpy: 1100,
    })
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

  it('accepts a self-authored item with operatorId (exactly-one refine survives .extend)', () => {
    const result = platformAdminCreateAddOnSchema.safeParse({
      ...selfAuthoredInput(),
      operatorId: 'op_best_car_rental',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.nameI18n).toEqual(NAME_I18N)
      expect(result.data.operatorId).toBe('op_best_car_rental')
    }
  })

  it('rejects both-identity input even with a valid operatorId', () => {
    const result = platformAdminCreateAddOnSchema.safeParse({
      templateId: TEMPLATE_ID,
      nameI18n: NAME_I18N,
      priceJpy: 1100,
      operatorId: 'op_best_car_rental',
    })
    expect(result.success).toBe(false)
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

  it('strips templateId on update — the retired picker field can never re-enter (identity is fixed, #1492)', () => {
    // A picked add-on's template identity is fixed at create; the update path
    // deliberately dropped templateId (#1437). Parse it ALONGSIDE a legit field so
    // the assertion proves the strip is surgical (not a blanket empty return): a
    // future edit that re-admits templateId to updateAddOnSchema fails right here.
    const result = updateAddOnSchema.safeParse({ priceJpy: 1500, templateId: TEMPLATE_ID })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('templateId')
      expect(result.data.priceJpy).toBe(1500)
    }
  })

  it('accepts a nameI18n update (self-authored edit adds a locale — D5)', () => {
    const result = updateAddOnSchema.safeParse({ nameI18n: NAME_I18N })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.nameI18n).toEqual(NAME_I18N)
  })

  it('rejects a nameI18n update missing the en floor', () => {
    const result = updateAddOnSchema.safeParse({ nameI18n: { ja: 'GPS ユニット' } })
    expect(result.success).toBe(false)
  })
})
