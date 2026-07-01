import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../../i18n/locales'
import { localizedTextSchema } from '../../i18n/localized-text'
import { slugify } from '../../i18n/slugify'
import { DEMO_ADD_ON_TEMPLATES } from './add-on-templates'
import { DEMO_ADD_ON_OPTIONS } from './add-ons'

describe('DEMO_ADD_ON_TEMPLATES', () => {
  it('carries EVERY supported locale in both name and description (the completeness guard)', () => {
    // localizedTextSchema only REQUIRES `en`; a missing ja/zh would compile and
    // silently fall back to English at read time. This is the one test that makes
    // a full translation mandatory for a shipped template. Assert TRIMMED non-empty
    // so a missing key (undefined), an empty string, or a whitespace-only value all
    // fail — none of those is a real translation.
    for (const template of DEMO_ADD_ON_TEMPLATES) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(template.name[locale]?.trim(), `${template.key} name.${locale}`).toBeTruthy()
        expect(
          template.description[locale]?.trim(),
          `${template.key} description.${locale}`,
        ).toBeTruthy()
      }
    }
  })

  it('has name and description bundles that satisfy localizedTextSchema', () => {
    for (const template of DEMO_ADD_ON_TEMPLATES) {
      expect(localizedTextSchema.safeParse(template.name).success).toBe(true)
      expect(localizedTextSchema.safeParse(template.description).success).toBe(true)
    }
  })

  it('keys equal slugify(name.en) — the join handle the slice-2 backfill matches on', () => {
    for (const template of DEMO_ADD_ON_TEMPLATES) {
      expect(template.key).toBe(slugify(template.name.en))
    }
  })

  it('has unique keys', () => {
    const keys = DEMO_ADD_ON_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('supplies a template for every distinct demo add-on name (no demo row backfills to ARCHIVED)', () => {
    const templateKeys = new Set(DEMO_ADD_ON_TEMPLATES.map((t) => t.key))
    const demoKeys = new Set(DEMO_ADD_ON_OPTIONS.map((o) => slugify(o.name)))
    for (const key of demoKeys) {
      expect(templateKeys.has(key), `no template for demo add-on key "${key}"`).toBe(true)
    }
  })
})
