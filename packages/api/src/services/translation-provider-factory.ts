import { GoogleTranslationProvider } from './google-translation-provider'
import type { TranslationProvider } from './translation-provider'

/**
 * Translation provider: real Google when the key is set. In production without a
 * key, a sentinel provider throws on first use (not at boot, so unrelated tests
 * can still run createApp). The stub is dev-only so a secret drift can't ship
 * working translations silently.
 */
export function createTranslationProvider(): TranslationProvider {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY
  if (key) return new GoogleTranslationProvider(key)
  if (process.env.NODE_ENV === 'production') {
    return {
      translate: async () => {
        throw new Error('GOOGLE_TRANSLATE_API_KEY not configured')
      },
    }
  }
  return {
    translate: async (text, source, targetLanguage) => ({
      translatedText: `[${targetLanguage}] ${text}`,
      detectedLanguage: source ?? targetLanguage,
    }),
  }
}
