import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { createTranslateRoutes } from '../../src/routes/translate'
import { MessageTranslationService } from '../../src/services/message-translation'
import { testAuthMiddleware } from '../helpers/auth'

function appWith(messageRepo: InMemoryMessageRepository) {
  const a = new Hono()
  const service = new MessageTranslationService(messageRepo, {
    translate: async (text, _src, target) => ({
      translatedText: `[${target}] ${text}`,
      detectedLanguage: 'ja',
    }),
  })
  a.use('*', testAuthMiddleware('u1', 'RENTER'))
  a.route('/', createTranslateRoutes(service))
  return a
}

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository
let messageId: string

beforeEach(async () => {
  threadRepo = new InMemoryThreadRepository()
  messageRepo = new InMemoryMessageRepository(threadRepo)
  const thread = await threadRepo.create({ userId: 'u1', role: 'RENTER' }, null, ['u1', 'u2'])
  const msg = await messageRepo.create({ userId: 'u1', role: 'RENTER' }, thread.id, 'こんにちは')
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
})
