import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// Boundary tests for the app-level auth gate on /messages/* (#707). These hit the
// real createApp() composition root WITHOUT the synthetic testAuthMiddleware, so
// they exercise requireAuth() exactly as production does. Before the fix the
// /messages mount was missing from the allow-list: requireUser threw a bare Error
// the global handler didn't map, so an unauthenticated probe returned 500 (and
// logged a stack trace) instead of a clean 401.

const RENTER = { sub: 'renter-1', role: 'RENTER' as const }

function createTestApp() {
  setupAuthEnv()
  const threadRepo = new InMemoryThreadRepository()
  const messageRepo = new InMemoryMessageRepository(threadRepo)
  const app = createApp({ threadRepo, messageRepo })
  return { app, threadRepo, messageRepo }
}

describe('POST /messages/:id/translate auth gate', () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(() => {
    ctx = createTestApp()
  })

  it('returns 401 (not 500) without auth', async () => {
    const res = await ctx.app.request('/messages/any-id/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('lets an authenticated caller reach the translate handler', async () => {
    const thread = await ctx.threadRepo.create({ userId: 'renter-1', role: 'RENTER' }, null, [
      'renter-1',
      'u2',
    ])
    const msg = await ctx.messageRepo.create(
      { userId: 'renter-1', role: 'RENTER' },
      thread.id,
      'こんにちは',
    )

    const res = await ctx.app.request(`/messages/${msg.id}/translate`, {
      method: 'POST',
      headers: { ...(await authHeaders(RENTER)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })

    expect(res.status).toBe(200)
    expect((await res.json()).data.language).toBe('en')
  })
})
