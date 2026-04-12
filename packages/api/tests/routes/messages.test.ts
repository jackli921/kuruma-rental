import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { requireAuth } from '../../src/middleware/auth'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { createMessageRoutes } from '../../src/routes/messages'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3'

let app: Hono
let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository

describe('Message Routes', () => {
  beforeEach(() => {
    setupAuthEnv()
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo)
    app = new Hono()
    app.use('*', requireAuth())
    app.route('/', createMessageRoutes(threadRepo, messageRepo))
  })

  describe('GET /threads', () => {
    it('returns empty list when no threads exist for user', async () => {
      const headers = await authHeaders({ sub: U1 })
      const res = await app.request('/threads', { headers })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({ success: true, data: [] })
    })

    it('returns created thread with participant info', async () => {
      const u1Headers = await authHeaders({ sub: U1 })
      // Create a thread with two participants
      await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })

      const res = await app.request('/threads', { headers: u1Headers })
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
      const u1Headers = await authHeaders({ sub: U1 })
      const u2Headers = await authHeaders({ sub: U2 })
      const u3Headers = await authHeaders({ sub: U3 })

      // Thread between user1 and user2
      await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })

      // Thread between user2 and user3 (user1 is NOT a participant)
      await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u2Headers },
        body: JSON.stringify({ participantIds: [U2, U3] }),
      })

      // user1 should only see 1 thread
      const res1 = await app.request('/threads', { headers: u1Headers })
      const body1 = await res1.json()
      expect(body1.success).toBe(true)
      expect(body1.data).toHaveLength(1)

      // user2 should see both threads
      const res2 = await app.request('/threads', { headers: u2Headers })
      const body2 = await res2.json()
      expect(body2.success).toBe(true)
      expect(body2.data).toHaveLength(2)

      // user3 should see only 1 thread
      const res3 = await app.request('/threads', { headers: u3Headers })
      const body3 = await res3.json()
      expect(body3.success).toBe(true)
      expect(body3.data).toHaveLength(1)
    })
  })

  describe('POST /threads', () => {
    it('creates a thread with participants', async () => {
      const headers = await authHeaders({ sub: U1 })
      const res = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
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
      const u1Headers = await authHeaders({ sub: U1 })
      // Create thread first
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

      const res = await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ content: 'Hello!', senderId: U1 }),
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
      const u1Headers = await authHeaders({ sub: U1 })
      const u2Headers = await authHeaders({ sub: U2 })
      // Create thread
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

      // Send two messages
      await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ content: 'Hello!', senderId: U1 }),
      })
      await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u2Headers },
        body: JSON.stringify({ content: 'Hi there!', senderId: U2 }),
      })

      const res = await app.request(`/threads/${threadId}`, { headers: u1Headers })

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
      const headers = await authHeaders({ sub: U1 })
      const res = await app.request('/threads/nonexistent-id', { headers })

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Thread not found')
    })
  })

  describe('POST /threads/:id/read', () => {
    it('resets unread count for user after messages are sent', async () => {
      const u1Headers = await authHeaders({ sub: U1 })
      const u2Headers = await authHeaders({ sub: U2 })

      // Create thread
      const createRes = await app.request('/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ participantIds: [U1, U2] }),
      })
      const created = await createRes.json()
      const threadId = created.data.id

      // user1 sends two messages (user2 gets unread incremented)
      await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ content: 'Hello!', senderId: U1 }),
      })
      await app.request(`/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u1Headers },
        body: JSON.stringify({ content: 'Are you there?', senderId: U1 }),
      })

      // Verify user2 has unread messages via thread list
      const beforeRes = await app.request('/threads', { headers: u2Headers })
      const beforeBody = await beforeRes.json()
      const user2Participant = beforeBody.data[0].participants.find(
        (p: { userId: string }) => p.userId === U2,
      )
      expect(user2Participant.unreadCount).toBe(2)

      // user2 marks as read (JWT sub = U2, no body.userId needed)
      const readRes = await app.request(`/threads/${threadId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...u2Headers },
        body: JSON.stringify({}),
      })

      expect(readRes.status).toBe(200)
      const readBody = await readRes.json()
      expect(readBody.success).toBe(true)

      // Verify unread count is now 0
      const afterRes = await app.request('/threads', { headers: u2Headers })
      const afterBody = await afterRes.json()
      const user2After = afterBody.data[0].participants.find(
        (p: { userId: string }) => p.userId === U2,
      )
      expect(user2After.unreadCount).toBe(0)
    })
  })
})
