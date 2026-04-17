import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { MessageTranslationService } from '../../src/services/message-translation'
import type { TranslationProvider } from '../../src/services/translation-provider'

const RENTER = { userId: 'u1', role: 'RENTER' as const }
const U2 = 'u2'

function stubProvider(map: Record<string, string>, detected?: string): TranslationProvider {
  return {
    translate: vi.fn(async (text: string, _source, target) => ({
      translatedText: map[`${text}|${target}`] ?? `[${target}] ${text}`,
      detectedLanguage: detected ?? 'ja',
    })),
  }
}

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository
let threadId: string
let messageId: string

beforeEach(async () => {
  threadRepo = new InMemoryThreadRepository()
  messageRepo = new InMemoryMessageRepository(threadRepo)
  const thread = await threadRepo.create(RENTER, null, [RENTER.userId, U2])
  threadId = thread.id
  const msg = await messageRepo.create(RENTER, threadId, 'こんにちは')
  messageId = msg.id
})

describe('MessageTranslationService.translate', () => {
  it('returns the cached translation without calling the provider on a cache hit', async () => {
    const cached = await messageRepo.updateTranslation(messageId, 'en', 'Hello (cached)', null)
    expect(cached).toBeDefined()

    const provider = stubProvider({})
    const service = new MessageTranslationService(messageRepo, provider)

    const result = await service.translate(RENTER, messageId, 'en')
    expect(result).toEqual({
      ok: true,
      translatedText: 'Hello (cached)',
      language: 'en',
      cached: true,
    })
    expect(provider.translate).not.toHaveBeenCalled()
  })

  it('calls the provider on a cache miss, persists the translation', async () => {
    const provider = stubProvider({ 'こんにちは|en': 'Hello' })
    const service = new MessageTranslationService(messageRepo, provider)

    const first = await service.translate(RENTER, messageId, 'en')
    expect(first).toEqual({
      ok: true,
      translatedText: 'Hello',
      language: 'en',
      cached: false,
    })
    expect(provider.translate).toHaveBeenCalledOnce()

    // Second call hits the cache.
    const second = await service.translate(RENTER, messageId, 'en')
    expect(second.ok && second.cached).toBe(true)
    expect(provider.translate).toHaveBeenCalledOnce() // still 1
  })

  it('persists detectedLanguage back to the message on cache miss', async () => {
    const provider = stubProvider({ 'こんにちは|en': 'Hello' }, 'ja')
    const service = new MessageTranslationService(messageRepo, provider)

    await service.translate(RENTER, messageId, 'en')
    const updated = await messageRepo.findById(RENTER, messageId)
    expect(updated?.sourceLanguage).toBe('ja')
  })

  it('returns 404 for an unknown message', async () => {
    const service = new MessageTranslationService(messageRepo, stubProvider({}))
    const result = await service.translate(RENTER, 'missing-id', 'en')
    expect(result).toEqual({ ok: false, status: 404, error: 'Message not found' })
  })

  it('returns 502 when the provider throws', async () => {
    const provider: TranslationProvider = {
      translate: vi.fn(async () => {
        throw new Error('Google API down')
      }),
    }
    const service = new MessageTranslationService(messageRepo, provider)
    const result = await service.translate(RENTER, messageId, 'en')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(502)
    expect(result.error).toMatch(/translation|provider/i)
  })

  it('returns 404 when a non-participant tries to translate', async () => {
    const outsider = { userId: 'stranger', role: 'RENTER' as const }
    const provider = stubProvider({ 'こんにちは|en': 'Hello' })
    const service = new MessageTranslationService(messageRepo, provider)

    const result = await service.translate(outsider, messageId, 'en')
    expect(result).toEqual({ ok: false, status: 404, error: 'Message not found' })
    // Must not have leaked via the provider cache either
    expect(provider.translate).not.toHaveBeenCalled()
  })
})
