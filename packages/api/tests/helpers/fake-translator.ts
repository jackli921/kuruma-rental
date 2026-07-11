import { type Locale, SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import type { LocalizedTextOverride } from '@kuruma/shared/i18n/localized-text'
import type { DescriptionTranslator } from '../../src/services/description-translation'

/**
 * Deterministic test double: source verbatim, every other locale `<locale>:<text>`.
 * Mutation-resistant — tests assert the exact filled value. Spy with
 * `vi.spyOn(translator, 'fill')` to assert zero-call (skip / picked / verbatim) paths.
 */
export function fakeDescriptionTranslator(): DescriptionTranslator {
  return {
    fill: async (sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride> => {
      const bag: LocalizedTextOverride = { [sourceLocale]: sourceText }
      for (const locale of SUPPORTED_LOCALES) {
        if (locale !== sourceLocale) bag[locale] = `${locale}:${sourceText}`
      }
      return bag
    },
  }
}

/** Simulates a total provider outage: fill returns only the source slot. */
export function sourceOnlyTranslator(): DescriptionTranslator {
  return {
    fill: async (sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride> => ({
      [sourceLocale]: sourceText,
    }),
  }
}
