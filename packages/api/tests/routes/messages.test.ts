import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { createMessageRoutes } from '../../src/routes/messages'
import { testAuthMiddleware } from '../helpers/auth'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3'

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository

/** Create a Hono app authenticated as the given user. */
function appAs(userId: string, role: 'RENTER' | 'STAFF' | 'ADMIN' = 'RENTER'): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware(userId, role))
  a.route('/', createMessageRoutes(threadRepo, messageRepo))
  return a
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
      // Create a thread with two participants
      await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })

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
      await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })

      // Thread between user2 and user3 (user1 is NOT a participant)
      await appAs(U2).request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U2, U3] }),
      })

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

  describe('POST /threads', () => {
    it('creates a thread with participants', async () => {
      const res = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantIds: [U1, U2],
        }),
      })

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(body.data.bookingId).toBeNull()
      expect(body.data.createdAt).toBeDefined()
      expect(body.data.updatedAt).toBeDefined()
    })

    describe('idempotency key', () => {
      const KEY_A = '00000000-0000-4000-8000-aaaa00000001'
      const KEY_B = '00000000-0000-4000-8000-aaaa00000002'

      it('returns 200 with same thread when duplicate key is sent', async () => {
        const first = await app.request('/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantIds: [U1, U2], idempotencyKey: KEY_A }),
        })
        expect(first.status).toBe(201)
        const firstBody = await first.json()

        const second = await app.request('/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantIds: [U1, U2], idempotencyKey: KEY_A }),
        })
        expect(second.status).toBe(200)
        const secondBody = await second.json()

        expect(secondBody.data.id).toBe(firstBody.data.id)
        expect(secondBody.data.idempotencyKey).toBe(KEY_A)
      })

      it('creates distinct threads when different keys are sent', async () => {
        const first = await app.request('/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantIds: [U1, U2], idempotencyKey: KEY_A }),
        })
        const second = await app.request('/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantIds: [U1, U2], idempotencyKey: KEY_B }),
        })

        expect(first.status).toBe(201)
        expect(second.status).toBe(201)

        const a = await first.json()
        const b = await second.json()
        expect(a.data.id).not.toBe(b.data.id)
      })

      it('creates thread without idempotency key for backward compatibility', async () => {
        const res = await app.request('/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantIds: [U1, U2] }),
        })
        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.data.idempotencyKey).toBeNull()
      })
    })
  })

  describe('access control', () => {
    it('POST /threads rejects when caller is not in participantIds', async () => {
      const res = await appAs(U1).request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U2, U3] }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Caller must be a participant')
    })

    it('STAFF can create thread between arbitrary users', async () => {
      const res = await appAs(U1, 'STAFF').request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U2, U3] }),
      })
      expect(res.status).toBe(201)
    })

    it('GET /threads/:id returns 404 for non-participant', async () => {
      const createRes = await appAs(U1).request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const threadId = (await createRes.json()).data.id

      const res = await appAs(U3).request(`/threads/${threadId}`)
      expect(res.status).toBe(404)
    })

    it('STAFF can read any thread regardless of participation', async () => {
      const createRes = await appAs(U1).request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const threadId = (await createRes.json()).data.id

      const res = await appAs(U3, 'STAFF').request(`/threads/${threadId}`)
      expect(res.status).toBe(200)
    })

    it('non-participant cannot send messages to thread', async () => {
      const createRes = await appAs(U1).request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const threadId = (await createRes.json()).data.id

      const res = await appAs(U3).request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Snooping!' }),
      })
      expect(res.status).toBe(404)
    })

    it('non-participant cannot mark thread as read', async () => {
      const createRes = await appAs(U1).request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const threadId = (await createRes.json()).data.id

      const res = await appAs(U3).request(`/threads/${threadId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: U3 }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /threads/:id/messages', () => {
    const MSG_KEY_A = '00000000-0000-4000-8000-bbbb00000001'
    const MSG_KEY_B = '00000000-0000-4000-8000-bbbb00000002'

    /** Helper: create a thread and return its id. */
    async function createThread(): Promise<string> {
      const res = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      return (await res.json()).data.id
    }

    it('sends a message to a thread', async () => {
      // Create thread first
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

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
    })
  })

  describe('GET /threads/:id', () => {
    it('returns thread with messages', async () => {
      // Create thread
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

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

    it('returns 404 for nonexistent thread', async () => {
      const res = await app.request('/threads/nonexistent-id')

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Thread not found')
    })
  })

  describe('POST /threads/:id/read', () => {
    it('resets unread count for user after messages are sent', async () => {
      // Create thread
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

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
