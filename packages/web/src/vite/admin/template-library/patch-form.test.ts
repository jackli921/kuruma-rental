import type { TemplateAdminRow } from '@kuruma/shared/types/template-admin'
import { describe, expect, it } from 'vitest'
import { buildTemplatePatch, formFromRow, isCatalogTemplateStatus } from './patch-form'

describe('isCatalogTemplateStatus', () => {
  it('accepts the catalog statuses and rejects anything else', () => {
    expect(isCatalogTemplateStatus('ACTIVE')).toBe(true)
    expect(isCatalogTemplateStatus('ARCHIVED')).toBe(true)
    expect(isCatalogTemplateStatus('DRAFT')).toBe(false)
    expect(isCatalogTemplateStatus('')).toBe(false)
  })
})

describe('formFromRow', () => {
  it('spreads each locale into its own field, blanking absent locales and a null description', () => {
    const row: TemplateAdminRow = {
      id: 'a1',
      key: 'baby-seat',
      name: { en: 'Baby seat', ja: 'ベビーシート' },
      description: null,
      status: 'ARCHIVED',
    }

    expect(formFromRow(row)).toEqual({
      name: { en: 'Baby seat', ja: 'ベビーシート', zh: '' },
      description: { en: '', ja: '', zh: '' },
      status: 'ARCHIVED',
    })
  })
})

describe('buildTemplatePatch', () => {
  it('assembles the name bundle, drops empty locales, and trims', () => {
    const patch = buildTemplatePatch({
      name: { en: '  Baby seat ', ja: 'ベビーシート', zh: '' },
      description: { en: '', ja: '', zh: '' },
      status: 'ACTIVE',
    })

    expect(patch.name).toEqual({ en: 'Baby seat', ja: 'ベビーシート' })
    expect(patch.status).toBe('ACTIVE')
  })

  it('clears the description (null) when its en field is empty', () => {
    const patch = buildTemplatePatch({
      name: { en: 'Baby seat', ja: '', zh: '' },
      description: { en: '', ja: 'ignored', zh: '' },
      status: 'ACTIVE',
    })

    expect(patch.description).toBeNull()
  })

  it('includes description locales only when en is present', () => {
    const patch = buildTemplatePatch({
      name: { en: 'Full cover', ja: '', zh: '' },
      description: { en: 'Zero deductible', ja: '', zh: '全额' },
      status: 'ACTIVE',
    })

    expect(patch.description).toEqual({ en: 'Zero deductible', zh: '全额' })
  })
})
