import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { createMessageRoutes } from '../../src/routes/messages'
import { fakeAuth } from '../helpers/auth'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3'

let app: Hono
let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository

describe('Message Routes', () => {
  beforeEach(() => {
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo)
    app = new Hono()
    app.use('*', fakeAuth({ id: U1, role: 'ADMIN' }))
    app.route('/', createMessageRoutes(threadRepo, messageRepo))
  })

  /** Create a separate Hono app authenticated as a different user. */
  function appAs(userId: string): Hono {
    const a = new Hono()
    a.use('*', fakeAuth({ id: userId, role: 'ADMIN' }))
    a.route('/', createMessageRoutes(threadRepo, messageRepo))
    return a
  }

  describe('GET /threads', () => {
    it('returns empty list when no threads exist for user', async () => {
      const res = await app.request('/threads')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({ success: true, data: [] })
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

    it('filters by authenticated user and only shows threads user participates in', async () => {
      // Thread between user1 and user2
      await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })

      // Thread between user2 and user3 (user1 is NOT a participant).
      // Use appAs(U2) so U1 isn't auto-added as creator.
      const app2Creator = appAs(U2)
      await app2Creator.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U2, U3] }),
      })

      // user1 (fakeAuth default) should only see 1 thread
      const res1 = await app.request('/threads')
      const body1 = await res1.json()
      expect(body1.success).toBe(true)
      expect(body1.data).toHaveLength(1)

      // user2 should see both threads
      const app2 = appAs(U2)
      const res2 = await app2.request('/threads')
      const body2 = await res2.json()
      expect(body2.success).toBe(true)
      expect(body2.data).toHaveLength(2)

      // user3 should see only 1 thread
      const app3 = appAs(U3)
      const res3 = await app3.request('/threads')
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
  })

  describe('POST /threads/:id/messages', () => {
    it('sends a message to a thread', async () => {
      // Create thread first
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

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

      // U1 sends a message (via default fakeAuth)
      await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      })

      // U2 sends a message (via separate app instance)
      const app2 = appAs(U2)
      await app2.request(`/threads/${threadId}/messages`, {
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
      await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      })
      await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Are you there?' }),
      })

      // Verify user2 has unread messages via repo (GET /threads uses JWT user)
      const app2 = appAs(U2)
      const beforeRes = await app2.request('/threads')
      const beforeBody = await beforeRes.json()
      const user2Participant = beforeBody.data[0].participants.find(
        (p: { userId: string }) => p.userId === U2,
      )
      expect(user2Participant.unreadCount).toBe(2)

      // user2 marks as read
      const readRes = await app2.request(`/threads/${threadId}/read`, {
        method: 'POST',
      })

      expect(readRes.status).toBe(200)
      const readBody = await readRes.json()
      expect(readBody.success).toBe(true)

      // Verify unread count is now 0
      const afterRes = await app2.request('/threads')
      const afterBody = await afterRes.json()
      const user2After = afterBody.data[0].participants.find(
        (p: { userId: string }) => p.userId === U2,
      )
      expect(user2After.unreadCount).toBe(0)
    })
  })

  describe('thread ownership checks', () => {
    it('non-participant RENTER cannot read a thread (returns 404)', async () => {
      // U1 (ADMIN) creates a thread with U1 and U2
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

      // U3 as RENTER tries to read it
      const outsider = new Hono()
      outsider.use('*', fakeAuth({ id: U3, role: 'RENTER' }))
      outsider.route('/', createMessageRoutes(threadRepo, messageRepo))

      const res = await outsider.request(`/threads/${threadId}`)
      expect(res.status).toBe(404)
    })

    it('non-participant RENTER cannot send messages to a thread', async () => {
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

      const outsider = new Hono()
      outsider.use('*', fakeAuth({ id: U3, role: 'RENTER' }))
      outsider.route('/', createMessageRoutes(threadRepo, messageRepo))

      const res = await outsider.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Snooping!' }),
      })
      expect(res.status).toBe(404)
    })

    it('POST /threads always includes creator as participant', async () => {
      // U1 creates a thread listing only U2, not themselves
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [U2] }),
      })
      const created = await createRes.json()
      expect(created.success).toBe(true)

      // Verify U1 can see it (they were auto-added)
      const threads = await app.request('/threads')
      const body = await threads.json()
      expect(body.data).toHaveLength(1)
    })
  })
})
