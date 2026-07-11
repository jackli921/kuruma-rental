import * as Sentry from '@sentry/cloudflare'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MachineDescriptionTranslator } from '../../src/services/description-translation'
import type { TranslationProvider } from '../../src/services/translation-provider'

// Mock Sentry so the MEDIUM-4 escalation is observable: without this the error
// path could drop the `Sentry.captureException` line and CI would stay green.
vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }))

// Deterministic fake: `<target><-<text>`, echoing the source code back so a
// mutation to the wiring (wrong source/target) changes the asserted value.
const echoProvider: TranslationProvider = {
  translate: async (text, source, target) => ({
    translatedText: `${target}<-${text}`,
    detectedLanguage: source ?? target,
  }),
}

describe('MachineDescriptionTranslator.fill', () => {
  // Restore in afterEach (not inline) so an assertion failure can never leak the
  // console.error spy into another test file; clear the Sentry vi.fn call history.
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('stores the source verbatim and fills every other locale via the provider', async () => {
    const translator = new MachineDescriptionTranslator(echoProvider)
    const bag = await translator.fill('ja', 'こんにちは')
    expect(bag).toEqual({ ja: 'こんにちは', en: 'en<-こんにちは', zh: 'zh<-こんにちは' })
  })

  it('drops (but logs) a locale whose provider call throws; source survives', async () => {
    const failingZh: TranslationProvider = {
      translate: async (text, source, target) => {
        if (target === 'zh') throw new Error('provider down')
        return { translatedText: `${target}<-${text}`, detectedLanguage: source ?? target }
      },
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const translator = new MachineDescriptionTranslator(failingZh)
    const bag = await translator.fill('ja', 'X')
    expect(bag).toEqual({ ja: 'X', en: 'en<-X' })
    expect(errSpy).toHaveBeenCalledOnce()
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error))
  })
})
