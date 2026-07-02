import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { createMessageRoutes } from '../../src/routes/messages'
import { MessageService } from '../../src/services/message'
import { testAuthMiddleware } from '../helpers/auth'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3'

type TestRole = 'RENTER' | 'PLATFORM_ADMIN' | 'OPERATOR_OWNER' | 'OPERATOR_STAFF'

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository

/** Create a Hono app authenticated as the given user. Pass `operatorId` to
 *  simulate a tenant-scoped OPERATOR_* caller. */
function appAs(userId: string, role: TestRole = 'RENTER', operatorId?: string): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware(userId, role, operatorId))
  // The operator new-message alert (#1205) is exercised in message.test.ts; the
  // route tests only assert HTTP behavior, so a no-op alert port keeps them focused.
  a.route('/', createMessageRoutes(new MessageService(threadRepo, messageRepo, async () => {})))
  return a
}

/** Seed a thread straight through the repo. POST /threads (caller-facing thread
 *  creation) was removed in #1386 as an unused arbitrary-counterparty spam vector;
 *  every real thread is created server-side by ensureThread, so tests seed the same
 *  way rather than through the API. SEED_CTX bypasses scope to stand in for that. */
const SEED_CTX = { userId: 'system', role: 'PLATFORM_ADMIN', bypassScope: true } as const

async function seedThread(
  participantIds: string[],
  opts: { operatorId?: string | null } = {},
): Promise<string> {
  const t = await threadRepo.create(SEED_CTX, null, participantIds, null, opts.operatorId ?? null)
  return t.id
}

describe('Message Routes', () => {
  let app: Hono

  beforeEach(() => {
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo)
    app = appAs(U1)
  })

  describe('GET /threads', () => {
    it('returns empty list when no threads exist for user', async () => {
      const res = await app.request('/threads')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    })

    it('returns created thread with participant info', async () => {
      await seedThread([U1, U2])

      const res = await app.request('/threads')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].participants).toHaveLength(2)
      expect(body.data[0].participants.map((p: { userId: string }) => p.userId).sort()).toEqual([
        U1,
        U2,
      ])
      expect(body.data[0].lastMessage).toBeNull()
    })

    it('filters by userId and only shows threads user participates in', async () => {
      // Thread between user1 and user2
      await seedThread([U1, U2])
      // Thread between user2 and user3 (user1 is NOT a participant)
      await seedThread([U2, U3])

      // user1 should only see 1 thread
      const res1 = await appAs(U1).request('/threads')
      const body1 = await res1.json()
      expect(body1.success).toBe(true)
      expect(body1.data).toHaveLength(1)

      // user2 should see both threads
      const res2 = await appAs(U2).request('/threads')
      const body2 = await res2.json()
      expect(body2.success).toBe(true)
      expect(body2.data).toHaveLength(2)

      // user3 should see only 1 thread
      const res3 = await appAs(U3).request('/threads')
      const body3 = await res3.json()
      expect(body3.success).toBe(true)
      expect(body3.data).toHaveLength(1)
    })
  })

  describe('access control', () => {
    // #1386: caller-facing thread creation was removed — it was unused by the web
    // and let any caller open a thread with arbitrary counterparties (a spam
    // vector). Threads are created server-side only, by ensureThread on a booking.
    it('POST /threads is not a route (thread creation is server-side only)', async () => {
      const res = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      expect(res.status).toBe(404)
    })

    it('GET /threads/:id returns 404 for non-participant', async () => {
      const threadId = await seedThread([U1, U2])

      const res = await appAs(U3).request(`/threads/${threadId}`)
      expect(res.status).toBe(404)
    })

    it('a platform admin can read any thread regardless of participation', async () => {
      const threadId = await seedThread([U1, U2])

      const res = await appAs(U3, 'PLATFORM_ADMIN').request(`/threads/${threadId}`)
      expect(res.status).toBe(200)
    })

    it('non-participant cannot send messages to thread', async () => {
      const threadId = await seedThread([U1, U2])

      const res = await appAs(U3).request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Snooping!' }),
      })
      expect(res.status).toBe(404)
    })

    it('non-participant cannot mark thread as read', async () => {
      const threadId = await seedThread([U1, U2])

      const res = await appAs(U3).request(`/threads/${threadId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: U3 }),
      })
      expect(res.status).toBe(404)
    })
  })

  // #1205 slice 2: the operator un-gate. Threads carry a server-derived
  // operatorId (set by ensureThread, never the request body); an OPERATOR_*
  // caller may read/reply only its own tenant's threads. Exploit path under
  // test: operator B must get a 404 — never a 200 read or a 201 reply — on
  // operator A's thread. Threads are seeded via the repo directly with an
  // operatorId, which only ensureThread sets (from the booking) in production.
  describe('operator tenant scoping (#1205)', () => {
    const OP_A = 'op-aaaa'
    const OP_B = 'op-bbbb'
    const STAFF_A = U1
    const STAFF_B = U3
    const RENTER = U2

    const SYSTEM = { userId: 'system', role: 'PLATFORM_ADMIN', bypassScope: true } as const

    async function seedThread(operatorId: string): Promise<string> {
      const t = await threadRepo.create(SYSTEM, 'booking-x', [RENTER], null, operatorId)
      return t.id
    }

    it('operator can read its own tenant thread', async () => {
      const id = await seedThread(OP_A)
      const res = await appAs(STAFF_A, 'OPERATOR_OWNER', OP_A).request(`/threads/${id}`)
      expect(res.status).toBe(200)
    })

    it('LEAK: operator cannot read another tenant’s thread (404)', async () => {
      const id = await seedThread(OP_A)
      const res = await appAs(STAFF_B, 'OPERATOR_OWNER', OP_B).request(`/threads/${id}`)
      expect(res.status).toBe(404)
    })

    it('operator can reply in its own tenant thread (senderId = staff)', async () => {
      const id = await seedThread(OP_A)
      const res = await appAs(STAFF_A, 'OPERATOR_OWNER', OP_A).request(`/threads/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'How can I help?' }),
      })
      expect(res.status).toBe(201)
      expect((await res.json()).data.senderId).toBe(STAFF_A)
    })

    it('LEAK: operator cannot reply in another tenant’s thread (404)', async () => {
      const id = await seedThread(OP_A)
      const res = await appAs(STAFF_B, 'OPERATOR_OWNER', OP_B).request(`/threads/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Snooping reply' }),
      })
      expect(res.status).toBe(404)
    })

    it('GET /threads lists only the operator’s own tenant threads', async () => {
      await seedThread(OP_A)
      await seedThread(OP_B)
      const res = await appAs(STAFF_A, 'OPERATOR_OWNER', OP_A).request('/threads')
      const body = await res.json()
      expect(body.data).toHaveLength(1)
    })
  })

  describe('POST /threads/:id/messages', () => {
    const MSG_KEY_A = '00000000-0000-4000-8000-bbbb00000001'
    const MSG_KEY_B = '00000000-0000-4000-8000-bbbb00000002'

    /** Helper: seed a thread and return its id (POST /threads was removed in #1386). */
    async function createThread(): Promise<string> {
      return seedThread([U1, U2])
    }

    it('sends a message to a thread', async () => {
      const threadId = await createThread()

      // senderId derived from JWT (U1)
      const res = await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      })

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.threadId).toBe(threadId)
      expect(body.data.senderId).toBe(U1)
      expect(body.data.content).toBe('Hello!')
      expect(body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(body.data.createdAt).toBeDefined()
    })

    describe('idempotency key', () => {
      it('returns 200 with same message when duplicate key is sent', async () => {
        const threadId = await createThread()

        const first = await app.request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hello!', idempotencyKey: MSG_KEY_A }),
        })
        expect(first.status).toBe(201)
        const firstBody = await first.json()

        const second = await app.request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hello!', idempotencyKey: MSG_KEY_A }),
        })
        expect(second.status).toBe(200)
        const secondBody = await second.json()

        expect(secondBody.data.id).toBe(firstBody.data.id)
        expect(secondBody.data.idempotencyKey).toBe(MSG_KEY_A)
      })

      it('creates distinct messages when different keys are sent', async () => {
        const threadId = await createThread()

        const first = await app.request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hello!', idempotencyKey: MSG_KEY_A }),
        })
        const second = await app.request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hello!', idempotencyKey: MSG_KEY_B }),
        })

        expect(first.status).toBe(201)
        expect(second.status).toBe(201)

        const a = await first.json()
        const b = await second.json()
        expect(a.data.id).not.toBe(b.data.id)
      })

      it('sends message without idempotency key for backward compatibility', async () => {
        const threadId = await createThread()

        const res = await app.request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hello!' }),
        })
        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.data.idempotencyKey).toBeNull()
      })

      it('concurrent duplicate requests yield exactly one 201 and one 200', async () => {
        const threadId = await createThread()
        const key = '00000000-0000-4000-8000-bbbb00000099'

        const [r1, r2] = await Promise.all([
          app.request(`/threads/${threadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'Hello!', idempotencyKey: key }),
          }),
          app.request(`/threads/${threadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'Hello!', idempotencyKey: key }),
          }),
        ])

        const statuses = [r1.status, r2.status].sort()
        expect(statuses).toEqual([200, 201])

        const b1 = await r1.json()
        const b2 = await r2.json()
        expect(b1.data.id).toBe(b2.data.id)
      })

      // Issue #328: findByIdempotencyKey must scope to sender. Two
      // participants in the same thread replaying the same key must
      // not see each other's messages.
      it('cross-tenant: U2 replaying U1 message key does not leak U1 message', async () => {
        // U1's thread with U2.
        const threadId = await seedThread([U1, U2])

        const sharedKey = '00000000-0000-4000-8000-bbbb0f0f0f01'
        const u1Msg = await appAs(U1).request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'From U1', idempotencyKey: sharedKey }),
        })
        expect(u1Msg.status).toBe(201)
        const u1MsgId = (await u1Msg.json()).data.id

        // U2 sends in the same thread with the same key. U2 must NOT get U1's message back.
        const u2Msg = await appAs(U2).request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'From U2', idempotencyKey: sharedKey }),
        })
        if (u2Msg.status === 200 || u2Msg.status === 201) {
          const body = await u2Msg.json()
          expect(body.data.id).not.toBe(u1MsgId)
          expect(body.data.senderId).toBe(U2)
        }
        expect([200, 201, 500]).toContain(u2Msg.status)
      })

      it('same sender replaying own key returns their existing message', async () => {
        const threadId = await createThread()
        const key = '00000000-0000-4000-8000-bbbb0f0f0f02'

        const first = await appAs(U1).request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hi', idempotencyKey: key }),
        })
        expect(first.status).toBe(201)
        const firstId = (await first.json()).data.id

        const replay = await appAs(U1).request(`/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hi', idempotencyKey: key }),
        })
        expect(replay.status).toBe(200)
        expect((await replay.json()).data.id).toBe(firstId)
      })
    })
  })

  describe('GET /threads/:id', () => {
    it('returns thread with messages', async () => {
      const threadId = await seedThread([U1, U2])

      // U1 sends a message
      await appAs(U1).request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      })
      // U2 replies
      await appAs(U2).request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi there!' }),
      })

      const res = await app.request(`/threads/${threadId}`)

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe(threadId)
      expect(body.data.participants).toHaveLength(2)
      expect(body.data.messages).toHaveLength(2)
      expect(body.data.messages[0].content).toBe('Hello!')
      expect(body.data.messages[0].senderId).toBe(U1)
      expect(body.data.messages[1].content).toBe('Hi there!')
      expect(body.data.messages[1].senderId).toBe(U2)
    })

    it('returns 404 for a valid-but-nonexistent thread id', async () => {
      const res = await app.request('/threads/00000000-0000-4000-8000-0000000000ff')

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Thread not found')
    })

    it('returns 400 for a malformed (non-uuid) thread id', async () => {
      const res = await app.request('/threads/nonexistent-id')

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('id must be a valid uuid')
    })
  })

  describe('POST /threads/:id/read', () => {
    it('resets unread count for user after messages are sent', async () => {
      const threadId = await seedThread([U1, U2])

      // user1 sends two messages (user2 gets unread incremented)
      await appAs(U1).request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      })
      await appAs(U1).request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Are you there?' }),
      })

      // Verify user2 has unread messages via thread list
      const beforeRes = await appAs(U2).request('/threads')
      const beforeBody = await beforeRes.json()
      const user2Participant = beforeBody.data[0].participants.find(
        (p: { userId: string }) => p.userId === U2,
      )
      expect(user2Participant.unreadCount).toBe(2)

      // user2 marks as read
      const readRes = await appAs(U2).request(`/threads/${threadId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: U2 }),
      })

      expect(readRes.status).toBe(200)
      const readBody = await readRes.json()
      expect(readBody.success).toBe(true)

      // Verify unread count is now 0
      const afterRes = await appAs(U2).request('/threads')
      const afterBody = await afterRes.json()
      const user2After = afterBody.data[0].participants.find(
        (p: { userId: string }) => p.userId === U2,
      )
      expect(user2After.unreadCount).toBe(0)
    })
  })
})
