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
  nameI18n: null,
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
  nameI18n: null,
}

// A SELF-AUTHORED row (#1437): no template (templateId/templateName null), so the
// operator's own nameI18n bundle drives the name, and the description resolves off
// descriptionOverride flooring to ANY present locale (there is no template floor).
const selfAuthored: AddOnWithTemplate = {
  ...templated,
  name: 'GPS unit', // legacy mirror = nameI18n.en
  description: null,
  templateId: null,
  templateName: null,
  templateDescription: null,
  nameI18n: { en: 'GPS unit', ja: 'GPS ユニット', zh: 'GPS 装置' },
  descriptionOverride: { ja: '自分で書いた説明' },
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

  it('resolves a self-authored row from its own nameI18n bundle', () => {
    expect(resolveAddOnName(selfAuthored, 'ja')).toBe('GPS ユニット')
  })

  it('falls back to the self-authored en name when the requested locale is absent', () => {
    const noZh: AddOnWithTemplate = {
      ...selfAuthored,
      nameI18n: { en: 'GPS unit', ja: 'GPS ユニット' },
    }
    expect(resolveAddOnName(noZh, 'zh')).toBe('GPS unit')
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

  it('resolves a self-authored description from descriptionOverride for its authored locale', () => {
    expect(resolveAddOnDescription(selfAuthored, 'ja')).toBe('自分で書いた説明')
  })

  it('floors a self-authored ja-only description to ja for a zh reader (no template floor)', () => {
    // Unlike a picked row (which floors to the template's zh/en), a self-authored
    // row has no template — so it must floor to ANY present locale rather than
    // render blank while the operator authored text.
    expect(resolveAddOnDescription(selfAuthored, 'zh')).toBe('自分で書いた説明')
  })

  it('returns null for a self-authored row with no description authored', () => {
    expect(resolveAddOnDescription({ ...selfAuthored, descriptionOverride: null }, 'ja')).toBeNull()
  })
})
