import type { LocalizedText } from '../../i18n/localized-text'
import type { insuranceTemplates } from '../schema'

/**
 * Curated, pre-translated insurance TEMPLATES (catalog i18n, slice 3). One
 * template per DISTINCT English insurance-tier name in DEMO_INSURANCE_OPTIONS: an
 * operator picks a template and the renter reads its localized name/description in
 * en/ja/zh instead of the operator's raw English string.
 *
 * `key` is the stable join handle and MUST equal slugify(name.en) — the slice-3
 * backfill matches an operator's legacy insurance name to a template by this key
 * (invariant asserted in insurance-templates.test.ts). `name.en` therefore mirrors
 * the canonical English name in DEMO_INSURANCE_OPTIONS exactly, and `description.en`
 * mirrors its canonical English description so a demo row maps cleanly (no spurious
 * override).
 *
 * status defaults ACTIVE (omitted here); the row id is derived seedId('tmpl_' +
 * key) in seed.ts. Every bundle MUST carry ALL SUPPORTED_LOCALES — that is THE
 * guard, since localizedTextSchema only requires `en`, so a missing `zh` would
 * silently fall back to English at read time.
 */
export type DemoInsuranceTemplate = Pick<
  typeof insuranceTemplates.$inferInsert,
  'key' | 'name' | 'description'
> & {
  readonly key: string
  readonly name: LocalizedText
  readonly description: LocalizedText
}

export const DEMO_INSURANCE_TEMPLATES: readonly DemoInsuranceTemplate[] = [
  {
    key: 'normal',
    name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
    description: {
      en: 'Standard collision cover with a 150,000 yen deductible.',
      ja: '免責額15万円の標準的な車両補償。',
      zh: '含15万日元自付额的标准碰撞保险。',
    },
  },
  {
    key: 'premium',
    name: { en: 'Premium', ja: 'プレミアム', zh: '高级' },
    description: {
      en: 'Lower out-of-pocket cover with a 250,000 yen deductible.',
      ja: '自己負担を抑えた補償。免責額25万円。',
      zh: '降低自付负担的保险，自付额25万日元。',
    },
  },
] as const
