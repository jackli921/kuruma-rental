import { describe, expect, it } from 'vitest'
import { resolveInsuranceName } from '../../src/services/insurance-resolve'
import type { InsuranceOption } from '../../src/stores'

function insuranceRow(overrides: Partial<InsuranceOption> = {}): InsuranceOption {
  return {
    id: 'ins_1',
    operatorId: 'op_1',
    name: 'Basic Cover',
    nameI18n: null,
    description: null,
    dailyPriceJpy: 1000,
    deductibleJpy: null,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('resolveInsuranceName', () => {
  it('returns the caller-locale value from the self-authored bundle', () => {
    const row = insuranceRow({
      nameI18n: { en: 'Basic Cover', ja: 'ベーシック補償', zh: '基本保障' },
    })
    expect(resolveInsuranceName(row, 'ja')).toBe('ベーシック補償')
    expect(resolveInsuranceName(row, 'zh')).toBe('基本保障')
    expect(resolveInsuranceName(row, 'en')).toBe('Basic Cover')
  })

  it('floors to English when the requested locale is absent from the bundle', () => {
    const row = insuranceRow({ nameI18n: { en: 'Basic Cover' } })
    expect(resolveInsuranceName(row, 'ja')).toBe('Basic Cover')
  })

  it('falls back to the name mirror for a legacy row (nameI18n null)', () => {
    const row = insuranceRow({ name: 'Legacy Plan', nameI18n: null })
    expect(resolveInsuranceName(row, 'ja')).toBe('Legacy Plan')
  })
})
