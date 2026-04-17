import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { InMemoryUserRepository } from '../../src/repositories/in-memory'
import { createCustomerRoutes } from '../../src/routes/customers'
import { CustomerService } from '../../src/services/customer'
import type { User } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const STAFF_ID = '00000000-0000-4000-8000-000000000001'
const RENTER_ID = '00000000-0000-4000-8000-000000000002'

function buildApp(role: 'STAFF' | 'ADMIN' | 'RENTER', userStore?: Map<string, User>) {
  const userId = role === 'RENTER' ? RENTER_ID : STAFF_ID
  const userRepo = new InMemoryUserRepository(userStore)
  const service = new CustomerService(userRepo)
  const app = new Hono()
  app.use('*', testAuthMiddleware(userId, role))
  app.route('/', createCustomerRoutes(service))
  return { app, userRepo }
}

function seedUsers(): Map<string, User> {
  const store = new Map<string, User>()
  store.set('u1', {
    id: 'u1',
    name: 'Tanaka Yuki',
    email: 'tanaka@example.com',
    phone: '+81-90-1234-5678',
    language: 'ja',
  })
  store.set('u2', {
    id: 'u2',
    name: 'Smith John',
    email: 'smith@example.com',
    phone: null,
    language: 'en',
  })
  store.set('u3', {
    id: 'u3',
    name: 'Chen Wei',
    email: 'chen@example.com',
    phone: '+86-138-0000-0000',
    language: 'zh',
  })
  return store
}

describe('Customer Routes', () => {
  describe('GET /customers?search=', () => {
    it('returns matching customers by name', async () => {
      const { app } = buildApp('STAFF', seedUsers())
      const res = await app.request('/customers?search=tanaka')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].name).toBe('Tanaka Yuki')
      expect(body.data[0].email).toBe('tanaka@example.com')
    })

    it('returns 403 for RENTER role', async () => {
      const { app } = buildApp('RENTER', seedUsers())
      const res = await app.request('/customers?search=tanaka')

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Forbidden')
    })

    it('returns 400 when search query is less than 2 characters', async () => {
      const { app } = buildApp('STAFF', seedUsers())
      const res = await app.request('/customers?search=a')

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Search query must be at least 2 characters')
    })

    it('returns 400 when search query is missing', async () => {
      const { app } = buildApp('STAFF', seedUsers())
      const res = await app.request('/customers')

      expect(res.status).toBe(400)
    })

    it('matches by email', async () => {
      const { app } = buildApp('STAFF', seedUsers())
      const res = await app.request('/customers?search=smith@')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].name).toBe('Smith John')
    })

    it('matches by phone', async () => {
      const { app } = buildApp('STAFF', seedUsers())
      const res = await app.request('/customers?search=1234-5678')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].name).toBe('Tanaka Yuki')
    })

    it('returns empty array when no matches', async () => {
      const { app } = buildApp('STAFF', seedUsers())
      const res = await app.request('/customers?search=zzzzz')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toEqual([])
    })
  })

  describe('POST /customers/quick-create', () => {
    it('creates a new customer with name and email', async () => {
      const { app } = buildApp('STAFF')
      const res = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Customer',
          email: 'new@example.com',
          language: 'en',
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.name).toBe('New Customer')
      expect(body.data.email).toBe('new@example.com')
      expect(body.data.id).toBeDefined()
    })

    it('is idempotent on email — returns existing user on second call', async () => {
      const { app } = buildApp('STAFF')
      const payload = {
        name: 'Duplicate Test',
        email: 'dup@example.com',
        language: 'en',
      }

      const res1 = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(res1.status).toBe(201)
      const body1 = await res1.json()

      const res2 = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(res2.status).toBe(200)
      const body2 = await res2.json()

      expect(body2.data.id).toBe(body1.data.id)
    })

    it('returns 400 when neither email nor phone is provided', async () => {
      const { app } = buildApp('STAFF')
      const res = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Contact' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 403 for RENTER role', async () => {
      const { app } = buildApp('RENTER')
      const res = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Forbidden',
          email: 'f@example.com',
        }),
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('creates customer with phone only (no email)', async () => {
      const { app } = buildApp('STAFF')
      const res = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Phone Only',
          phone: '+81-90-9999-8888',
          language: 'ja',
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.name).toBe('Phone Only')
      expect(body.data.phone).toBe('+81-90-9999-8888')
    })

    it('is idempotent on phone — returns existing user', async () => {
      const { app } = buildApp('STAFF')
      const payload = {
        name: 'Phone Dup',
        phone: '+81-90-1111-2222',
        language: 'ja',
      }

      const res1 = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(res1.status).toBe(201)
      const body1 = await res1.json()

      const res2 = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(res2.status).toBe(200)
      const body2 = await res2.json()

      expect(body2.data.id).toBe(body1.data.id)
    })

    it('defaults language to en when not specified', async () => {
      const { app } = buildApp('STAFF')
      const res = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Default Lang',
          email: 'deflang@example.com',
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.language).toBe('en')
    })

    it('returns 400 when name is empty', async () => {
      const { app } = buildApp('STAFF')
      const res = await app.request('/customers/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '',
          email: 'valid@example.com',
        }),
      })

      expect(res.status).toBe(400)
    })
  })
})
