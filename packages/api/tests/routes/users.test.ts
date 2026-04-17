import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryUserRepository } from '../../src/repositories/in-memory'
import { createUserRoutes } from '../../src/routes/users'
import { setupAuthEnv, testAuthMiddleware } from '../helpers/auth'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'

let userRepo: InMemoryUserRepository
let app: Hono

beforeEach(() => {
  const store = new Map([
    [U1, { id: U1, name: 'Alice', email: 'a@x', language: 'en' }],
    [U2, { id: U2, name: 'Bob', email: 'b@x', language: 'en' }],
  ])
  userRepo = new InMemoryUserRepository(store)
  app = new Hono()
  app.use('*', testAuthMiddleware(U1, 'RENTER'))
  app.route('/', createUserRoutes(userRepo))
})

describe('User Routes', () => {
  describe('GET /users', () => {
    it('returns id+name pairs for the requested ids', async () => {
      const res = await app.request(`/users?ids=${U1},${U2}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.data).toContainEqual({ id: U1, name: 'Alice' })
      expect(body.data).toContainEqual({ id: U2, name: 'Bob' })
    })

    it('rejects malformed uuids with 400', async () => {
      const res = await app.request(`/users?ids=${U1},not-a-uuid`)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('rejects requests with more than 50 ids', async () => {
      const ids = Array.from(
        { length: 51 },
        (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
      ).join(',')
      const res = await app.request(`/users?ids=${ids}`)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toMatch(/50/)
    })

    it('returns empty array when ids parameter is missing or empty', async () => {
      const missing = await app.request('/users')
      expect(missing.status).toBe(200)
      expect((await missing.json()).data).toEqual([])

      const empty = await app.request('/users?ids=')
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
