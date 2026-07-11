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

      const translated = result.status === 'fulfilled' ? result.value.translatedText.trim() : ''
      if (translated) {
        bag[target] = translated
        continue
      }

      // Drop a rejected leg OR an empty/whitespace machine result so the reader
      // falls through to the source: resolveOwnDescription treats an ABSENT locale
      // (not '') as the fallback trigger, so persisting '' would render blank for
      // that reader — puncturing the same non-empty guarantee the inbound Zod
      // `.min(1)` enforces. MEDIUM-4: never a fully-silent drop — a key/API drift
      // would otherwise degrade every save with no signal.
      const reason =
        result.status === 'rejected' ? result.reason : new Error(`empty translation (${target})`)
      console.error('Add-on description translation failed', {
        sourceLocale,
        target,
        err: reason instanceof Error ? reason.message : String(reason),
      })
      Sentry.captureException(reason)
    }
    return bag
  }
}
