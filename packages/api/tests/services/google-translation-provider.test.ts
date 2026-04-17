import { describe, expect, it, vi } from 'vitest'
import { GoogleTranslationProvider } from '../../src/services/google-translation-provider'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('GoogleTranslationProvider', () => {
  it('posts the text + target to the Google endpoint and returns the translation', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: {
          translations: [{ translatedText: 'Hello', detectedSourceLanguage: 'ja' }],
        },
      }),
    )
    const provider = new GoogleTranslationProvider('test-key', fetchFn)

    const result = await provider.translate('こんにちは', null, 'en')
    expect(result).toEqual({ translatedText: 'Hello', detectedLanguage: 'ja' })

    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://translation.googleapis.com/language/translate/v2')
    expect(init?.method).toBe('POST')
    const body = init?.body as string
    expect(body).toContain('key=test-key')
    expect(body).toContain('target=en')
    expect(body).toContain('q=')
  })

  it('passes source when provided', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: { translations: [{ translatedText: 'Hi' }] },
      }),
    )
    const provider = new GoogleTranslationProvider('key', fetchFn)
    await provider.translate('hi', 'ja', 'en')
    expect(fetchFn.mock.calls[0]![1]!.body as string).toContain('source=ja')
  })

  it('throws with the Google error message on non-2xx', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { message: 'API key invalid' } }, { status: 400 }),
    )
    const provider = new GoogleTranslationProvider('bad-key', fetchFn)
    await expect(provider.translate('x', null, 'en')).rejects.toThrow('API key invalid')
  })

  it('throws if Google returns no translations', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: { translations: [] } }))
    const provider = new GoogleTranslationProvider('key', fetchFn)
    await expect(provider.translate('x', null, 'en')).rejects.toThrow(/no translation/i)
  })

  it('falls back to targetLanguage for detectedLanguage when Google omits it', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ data: { translations: [{ translatedText: 'Hi' }] } }),
    )
    const provider = new GoogleTranslationProvider('key', fetchFn)
    const result = await provider.translate('hi', null, 'en')
    expect(result.detectedLanguage).toBe('en')
  })
})
