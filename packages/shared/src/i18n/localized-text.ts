import { z } from 'zod'

import type { Locale } from './locales'

/**
 * A localized text bundle: the shape behind every catalog template name /
 * description and every operator description override.
 *
 * `en` is REQUIRED (the guaranteed fallback), other locales optional, unknown
 * keys rejected (`.strict()`), and every present value `.min(1)` so an empty
 * slot can never render blank — the resolver only falls through on an
 * absent/undefined locale.
 *
 * Hand-written literal (NOT a reduce over SUPPORTED_LOCALES) to keep the
 * en-required precision; adding a locale is one optional line here.
 */
export const localizedTextSchema = z
  .object({
    en: z.string().min(1),
    ja: z.string().min(1).optional(),
    zh: z.string().min(1).optional(),
  })
  .strict()

export type LocalizedText = z.infer<typeof localizedTextSchema>

/**
 * The one resolver for template name, template description, and override.
 * Falls back to `en` when the requested locale is absent. Typechecks under
 * `noUncheckedIndexedAccess` (`bundle[locale]` is `string | undefined`).
 */
export function resolveLocalized(bundle: LocalizedText, locale: Locale): string {
  return bundle[locale] ?? bundle.en
}
