import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// Messaging GA hardening (Refs #1476): prove the per-user messaging limiters are
// resolved AND routed by the composition root — not just by the route factories.
// These go through the real createApp(), so a wiring swap (send limiter applied to
// translate, or vice versa) or a dropped argument is caught here, where the
// route-factory unit tests structurally cannot see it.

const RENTER = { sub: 'renter-1', role: 'RENTER' as const }

/** In-process stand-in for the CF native rate-limit binding. */
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

function createTestApp(opts?: {
  messageSendLimiter?: RateLimitBinding
  messageTranslateLimiter?: RateLimitBinding
}) {
  setupAuthEnv()
  const threadRepo = new InMemoryThreadRepository()
  const messageRepo = new InMemoryMessageRepository(threadRepo)
  const app = createApp({
    threadRepo,
    messageRepo,
    messageSendLimiter: opts?.messageSendLimiter,
    messageTranslateLimiter: opts?.messageTranslateLimiter,
  })
  return { app, threadRepo, messageRepo }
}

async function seedThreadAndMessage(ctx: ReturnType<typeof createTestApp>): Promise<{
  threadId: string
  messageId: string
}> {
  const thread = await ctx.threadRepo.create({ userId: 'renter-1', role: 'RENTER' }, null, [
    'renter-1',
    'u2',
  ])
  const { message } = await ctx.messageRepo.create(
    { userId: 'renter-1', role: 'RENTER' },
    thread.id,
    'こんにちは',
  )
  return { threadId: thread.id, messageId: message.id }
}

const jsonHeaders = async () => ({
  ...(await authHeaders(RENTER)),
  'Content-Type': 'application/json',
})

const send = (
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  threadId: string,
  headers: HeadersInit,
) =>
  app.request(`/threads/${threadId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: 'flood' }),
  })

const translate = (
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  messageId: string,
  headers: HeadersInit,
  targetLanguage: string,
) =>
  app.request(`/messages/${messageId}/translate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetLanguage }),
  })

describe('messaging per-user rate limits (composition root wiring)', () => {
  let ctx: ReturnType<typeof createTestApp>
  let headers: HeadersInit
  let ids: { threadId: string; messageId: string }

  describe('send limiter wired to POST /threads/:id/messages only', () => {
    beforeEach(async () => {
      ctx = createTestApp({ messageSendLimiter: createFakeLimiter(1) })
      headers = await jsonHeaders()
      ids = await seedThreadAndMessage(ctx)
    })

    it('429s the second send once the per-user send limit is exceeded', async () => {
      expect((await send(ctx.app, ids.threadId, headers)).status).toBe(201)
      expect((await send(ctx.app, ids.threadId, headers)).status).toBe(429)
    })

    it('does not apply the send limiter to translate (no swap)', async () => {
      expect((await translate(ctx.app, ids.messageId, headers, 'en')).status).toBe(200)
      expect((await translate(ctx.app, ids.messageId, headers, 'zh')).status).toBe(200)
    })
  })

  describe('translate limiter wired to POST /messages/:id/translate only', () => {
    beforeEach(async () => {
      ctx = createTestApp({ messageTranslateLimiter: createFakeLimiter(1) })
      headers = await jsonHeaders()
      ids = await seedThreadAndMessage(ctx)
    })

    it('429s the second translate once the per-user translate limit is exceeded', async () => {
      expect((await translate(ctx.app, ids.messageId, headers, 'en')).status).toBe(200)
      expect((await translate(ctx.app, ids.messageId, headers, 'zh')).status).toBe(429)
    })

    it('does not apply the translate limiter to sends (no swap)', async () => {
      expect((await send(ctx.app, ids.threadId, headers)).status).toBe(201)
      expect((await send(ctx.app, ids.threadId, headers)).status).toBe(201)
    })
  })
})
