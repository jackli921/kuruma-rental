import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { createTranslateRoutes } from '../../src/routes/translate'
import { MessageTranslationService } from '../../src/services/message-translation'
import { testAuthMiddleware } from '../helpers/auth'

/** In-process stand-in for the CF native rate-limit binding: counts per key and
 *  denies past `limit`, mirroring the vehicle-photo rate-limit test double. */
function createFakeLimiter(limit: number): RateLimitBinding {
  const counts = new Map<string, number>()
  return {
    async limit({ key }) {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return { success: next <= limit }
    },
  }
}

function appWith(messageRepo: InMemoryMessageRepository, limiter?: RateLimitBinding) {
  const a = new Hono()
  const service = new MessageTranslationService(messageRepo, {
    translate: async (text, _src, target) => ({
      translatedText: `[${target}] ${text}`,
      detectedLanguage: 'ja',
    }),
  })
  a.use('*', testAuthMiddleware('u1', 'RENTER'))
  a.route('/', createTranslateRoutes(service, limiter))
  return a
}

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository
let messageId: string

beforeEach(async () => {
  threadRepo = new InMemoryThreadRepository()
  messageRepo = new InMemoryMessageRepository(threadRepo)
  const thread = await threadRepo.create({ userId: 'u1', role: 'RENTER' }, null, ['u1', 'u2'])
  const { message: msg } = await messageRepo.create(
    { userId: 'u1', role: 'RENTER' },
    thread.id,
    'こんにちは',
  )
  messageId = msg.id
})

describe('POST /messages/:id/translate', () => {
  it('returns the translation with cached=false on first call', async () => {
    const res = await appWith(messageRepo).request(`/messages/${messageId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      success: true,
      data: { translatedText: '[en] こんにちは', language: 'en', cached: false },
    })
  })

  it('returns cached=true on subsequent calls', async () => {
    const app = appWith(messageRepo)
    await app.request(`/messages/${messageId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })
    const second = await app.request(`/messages/${messageId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })
    const body = await second.json()
    expect(body.data.cached).toBe(true)
  })

  it('returns 404 for a valid-but-unknown message id', async () => {
    const res = await appWith(messageRepo).request(
      '/messages/00000000-0000-4000-8000-0000000000ff/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguage: 'en' }),
      },
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 for a malformed (non-uuid) message id', async () => {
    const res = await appWith(messageRepo).request('/messages/nonexistent/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('id must be a valid uuid')
  })

  it('rejects an invalid targetLanguage with 400', async () => {
    const res = await appWith(messageRepo).request(`/messages/${messageId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'xx' }),
    })
    expect(res.status).toBe(400)
  })

  // Messaging GA hardening (Refs #1476): each uncached (message, language) hits an
  // external translation provider, so cap it per authenticated user (per-user beats
  // the global per-IP limiter behind NAT). The limiter runs before the handler.
  it('returns 429 once the per-user translate limit is exceeded', async () => {
    const app = appWith(messageRepo, createFakeLimiter(1))

    const first = await app.request(`/messages/${messageId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })
    const second = await app.request(`/messages/${messageId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'zh' }),
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
  })

  it('does not rate-limit when no binding is injected (local dev)', async () => {
    const app = appWith(messageRepo)
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/messages/${messageId}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguage: 'en' }),
      })
      expect(res.status).toBe(200)
    }
  })
})
