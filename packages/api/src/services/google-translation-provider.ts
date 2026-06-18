import { boundFetch } from '@kuruma/shared/lib/bound-fetch'

import type { TranslationProvider } from './translation-provider'

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2'
const TIMEOUT_MS = 3000
const MAX_ATTEMPTS = 2 // initial call + 1 retry

interface GoogleResponse {
  data?: {
    translations?: Array<{ translatedText: string; detectedSourceLanguage?: string }>
  }
  error?: { message: string }
}

/**
 * Google Cloud Translation v2 REST client. REST over SDK so we run on
 * the Cloudflare Workers runtime without Node-only deps.
 *
 * Resilience: every request has a 3s timeout via AbortSignal, and transient
 * failures (network error or 5xx) trigger a single retry. 4xx responses are
 * returned immediately — they're caller errors, not transient upstream issues.
 */
export class GoogleTranslationProvider implements TranslationProvider {
  constructor(
    private readonly apiKey: string,
    // boundFetch keeps this === globalThis when called detached as this.fetchFn;
    // a bare global fetch throws "Illegal invocation" on CF Workers (#887/#893).
    private readonly fetchFn: typeof fetch = boundFetch,
  ) {}

  async translate(
    text: string,
    sourceLanguage: string | null,
    targetLanguage: string,
  ): Promise<{ translatedText: string; detectedLanguage: string }> {
    const params = new URLSearchParams({
      q: text,
      target: targetLanguage,
      format: 'text',
    })
    if (sourceLanguage) params.set('source', sourceLanguage)
    const body = params.toString()

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetchFn(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Goog-Api-Key': this.apiKey,
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        // 5xx is transient — retry. 4xx is the caller's problem — bail.
        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
          lastError = new Error(`Google Translate returned ${response.status}`)
          continue
        }

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
      } catch (err) {
        // Network error (including AbortError from timeout) — retry once.
        // Our own throws above (no-translation, 4xx) also land here, but we
        // only retry when we have attempts left AND the error is transient.
        const isTransient = isNetworkError(err)
        if (isTransient && attempt < MAX_ATTEMPTS) {
          lastError = err
          continue
        }
        throw err
      }
    }

    throw lastError ?? new Error('Google Translate: exhausted retries')
  }
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true // fetch failed
  if (err instanceof Error && err.name === 'AbortError') return true // timeout
  if (err instanceof DOMException && err.name === 'TimeoutError') return true
  return false
}
