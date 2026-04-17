/**
 * Provider-agnostic translation contract. Implementations call external
 * services (Google Translate, DeepL, etc.); the service layer depends on
 * this interface so providers can be swapped at the composition root.
 */
export interface TranslationProvider {
  /**
   * Translate `text` into `targetLanguage`. If `sourceLanguage` is null,
   * the provider should auto-detect and return the detected code.
   *
   * Throws on provider failure — the service layer catches and maps
   * to a 502 at the HTTP boundary.
   */
  translate(
    text: string,
    sourceLanguage: string | null,
    targetLanguage: string,
  ): Promise<{ translatedText: string; detectedLanguage: string }>
}
