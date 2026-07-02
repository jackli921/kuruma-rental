import { describe, expect, it } from 'vitest'
import { resolveAddOnDescription, resolveAddOnName } from '../../src/services/add-on-resolve'
import type { AddOnWithTemplate } from '../../src/stores'

// A templated read row: the LEFT JOIN carried the template's localized bundles,
// so name/description resolve off the template, not the legacy columns.
const templated: AddOnWithTemplate = {
  id: 'a1',
  operatorId: 'op',
  name: 'Baby Seat', // legacy free-text column (the resolved en name post-backfill)
  description: 'legacy column desc',
  templateId: 'tmpl_child_seat',
  descriptionOverride: null,
  priceJpy: 1500,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  templateName: { en: 'Child Seat', ja: 'チャイルドシート', zh: '儿童座椅' },
  templateDescription: { en: 'A child seat', ja: '子供用シート', zh: '儿童座椅描述' },
}

// A legacy null-templateId row (PR1 window): no JOIN match, so the bundles are
// null and resolution must fall back to the `name`/`description` columns.
const legacy: AddOnWithTemplate = {
  ...templated,
  templateId: null,
  templateName: null,
  templateDescription: null,
}

describe('resolveAddOnName', () => {
  it('resolves a templated row to the requested locale from the template bundle', () => {
    expect(resolveAddOnName(templated, 'ja')).toBe('チャイルドシート')
  })

  it('falls back to the template en when the requested locale is absent', () => {
    const noZh: AddOnWithTemplate = {
      ...templated,
      templateName: { en: 'Child Seat', ja: 'チャイルドシート' },
    }
    expect(resolveAddOnName(noZh, 'zh')).toBe('Child Seat')
  })

  it('falls back to the legacy name column when the row carries no template', () => {
    expect(resolveAddOnName(legacy, 'ja')).toBe('Baby Seat')
  })
})

describe('resolveAddOnDescription', () => {
  it('resolves a templated row description to the requested locale', () => {
    expect(resolveAddOnDescription(templated, 'zh')).toBe('儿童座椅描述')
  })

  it('lets an operator override win for its authored locale', () => {
    const overridden: AddOnWithTemplate = {
      ...templated,
      descriptionOverride: { ja: 'オペレーター独自の説明' },
    }
    expect(resolveAddOnDescription(overridden, 'ja')).toBe('オペレーター独自の説明')
  })

  it('never leaks a ja-only override to a zh reader (falls to the template zh)', () => {
    const overridden: AddOnWithTemplate = {
      ...templated,
      descriptionOverride: { ja: 'オペレーター独自の説明' },
    }
    expect(resolveAddOnDescription(overridden, 'zh')).toBe('儿童座椅描述')
  })

  it('falls back to the legacy description column when the row carries no template', () => {
    expect(resolveAddOnDescription(legacy, 'ja')).toBe('legacy column desc')
  })

  it('returns null for a legacy row whose description column is null', () => {
    expect(resolveAddOnDescription({ ...legacy, description: null }, 'ja')).toBeNull()
  })
})
