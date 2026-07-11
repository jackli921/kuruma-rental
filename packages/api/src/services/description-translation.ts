import { type Locale, SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import type { LocalizedTextOverride } from '@kuruma/shared/i18n/localized-text'
import * as Sentry from '@sentry/cloudflare'
import type { TranslationProvider } from './translation-provider'

/**
 * Fills an add-on description override so every locale carries text. Model B
 * (#1318): the operator authors one locale; this re-derives the others by MT on
 * every save. Best-effort — a locale whose provider call fails is omitted and the
 * reader falls back via resolveOwnDescription; it is never fatal to the save.
 */
export interface DescriptionTranslator {
  fill(sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride>
}

export class MachineDescriptionTranslator implements DescriptionTranslator {
  constructor(private readonly provider: TranslationProvider) {}

  async fill(sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride> {
    // Non-source locales in parallel: total wall-clock ≈ one provider call
    // (TIMEOUT_MS × MAX_ATTEMPTS ≈ 6s), not the sum (LOW-6). allSettled so one
    // rejection never sinks the others.
    const targets = SUPPORTED_LOCALES.filter((locale) => locale !== sourceLocale)
    const settled = await Promise.allSettled(
      targets.map((target) => this.provider.translate(sourceText, sourceLocale, target)),
    )

    const bag: LocalizedTextOverride = { [sourceLocale]: sourceText }
    for (const [index, result] of settled.entries()) {
      const target = targets[index]
      if (!target) continue
      if (result.status === 'fulfilled') {
        bag[target] = result.value.translatedText
      } else {
        // MEDIUM-4: never a fully-silent drop. Request obs only reports 5xx/slow,
        // so a GOOGLE_TRANSLATE_API_KEY drift would degrade every save with no
        // signal. Parity with message-translation.ts, plus Sentry.
        console.error('Add-on description translation failed', {
          sourceLocale,
          target,
          err: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
        Sentry.captureException(result.reason)
      }
    }
    return bag
  }
}
