import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryThreadRepository, InMemoryUserRepository } from '../../src/repositories/in-memory'
import { createUserRoutes } from '../../src/routes/users'
import { setupAuthEnv, testAuthMiddleware } from '../helpers/auth'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3' // not a thread participant of U1

let userRepo: InMemoryUserRepository
let threadRepo: InMemoryThreadRepository

function appAs(userId: string, role: 'RENTER' | 'STAFF' | 'ADMIN' = 'RENTER'): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware(userId, role))
  a.route('/', createUserRoutes(userRepo, threadRepo))
  return a
}

beforeEach(async () => {
  const store = new Map([
    [U1, { id: U1, name: 'Alice', email: 'a@x', language: 'en' }],
    [U2, { id: U2, name: 'Bob', email: 'b@x', language: 'en' }],
    [U3, { id: U3, name: 'Carol', email: 'c@x', language: 'en' }],
  ])
  userRepo = new InMemoryUserRepository(store)
  threadRepo = new InMemoryThreadRepository()
  // U1 and U2 share a thread; U3 is unrelated to U1.
  await threadRepo.create({ userId: U1, role: 'RENTER' }, null, [U1, U2], null)
})

describe('User Routes', () => {
  describe('GET /users — name resolution scoped to thread participants', () => {
    it('returns id+name pairs for ids the caller shares a thread with', async () => {
      const res = await appAs(U1).request(`/users?ids=${U1},${U2}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.data).toContainEqual({ id: U1, name: 'Alice' })
      expect(body.data).toContainEqual({ id: U2, name: 'Bob' })
    })

    it('omits ids the renter does not share a thread with (no enumeration oracle)', async () => {
      const res = await appAs(U1).request(`/users?ids=${U2},${U3}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data).toContainEqual({ id: U2, name: 'Bob' })
      // U3 is intentionally NOT present — caller has no thread with U3.
    })

    it('returns empty array when none of the ids are in the caller-allowed set', async () => {
      const res = await appAs(U1).request(`/users?ids=${U3}`)
      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual([])
    })

    it('allows privileged roles (STAFF/ADMIN) to resolve any user', async () => {
      const res = await appAs(U1, 'STAFF').request(`/users?ids=${U2},${U3}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(2)
    })
  })

  describe('GET /users — input validation', () => {
    it('rejects malformed uuids with 400', async () => {
      const res = await appAs(U1).request(`/users?ids=${U1},not-a-uuid`)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('rejects requests with more than 50 ids', async () => {
      const ids = Array.from(
        { length: 51 },
        (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
      ).join(',')
      const res = await appAs(U1).request(`/users?ids=${ids}`)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toMatch(/50/)
    })

    it('returns empty array when ids parameter is missing or empty', async () => {
      const a = appAs(U1)
      const missing = await a.request('/users')
      expect(missing.status).toBe(200)
      expect((await missing.json()).data).toEqual([])

      const empty = await a.request('/users?ids=')
      expect(empty.status).toBe(200)
      expect((await empty.json()).data).toEqual([])
    })
  })

  describe('auth wiring', () => {
    it('returns 401 when called via createApp() without Authorization header', async () => {
      setupAuthEnv()
      const app = createApp()
      const res = await app.request(`/users?ids=${U1}`)
      expect(res.status).toBe(401)
    })
  })
})
