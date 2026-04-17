import type { TranslationProvider } from './translation-provider'

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2'

interface GoogleResponse {
  data?: {
    translations?: Array<{ translatedText: string; detectedSourceLanguage?: string }>
  }
  error?: { message: string }
}

/**
 * Google Cloud Translation v2 REST client. REST over SDK so we run on
 * the Cloudflare Workers runtime without Node-only deps.
 */
export class GoogleTranslationProvider implements TranslationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async translate(
    text: string,
    sourceLanguage: string | null,
    targetLanguage: string,
  ): Promise<{ translatedText: string; detectedLanguage: string }> {
    const params = new URLSearchParams({
      key: this.apiKey,
      q: text,
      target: targetLanguage,
      format: 'text',
    })
    if (sourceLanguage) params.set('source', sourceLanguage)

    const response = await this.fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    const json = (await response.json()) as GoogleResponse

    if (!response.ok || json.error) {
      throw new Error(json.error?.message ?? `Google Translate returned ${response.status}`)
    }

    const translation = json.data?.translations?.[0]
    if (!translation) {
      throw new Error('Google Translate returned no translation')
    }

    return {
      translatedText: translation.translatedText,
      detectedLanguage: translation.detectedSourceLanguage ?? sourceLanguage ?? targetLanguage,
    }
  }
}
