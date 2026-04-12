import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fail, ok, parseBody, parseDateRange } from '../../src/routes/helpers'

// Tiny Hono app that uses the helpers so we can test through real HTTP.
function createTestApp() {
  const app = new Hono()

  app.get('/ok', (c) => ok(c, { id: 1, name: 'test' }))
  app.get('/ok-201', (c) => ok(c, { id: 1 }, 201))
  app.get('/fail-400', (c) => fail(c, 'bad request', 400))
  app.get('/fail-404', (c) => fail(c, 'not found', 404))
  app.get('/fail-extras', (c) =>
    fail(c, 'rule violated', 400, { code: 'RULE_X', details: { required: 6 } }),
  )

  const testSchema = z.object({
    name: z.string(),
    age: z.number().int().positive(),
  })

  app.post('/parse-body', async (c) => {
    const result = await parseBody(c, testSchema)
    if (!result.ok) return result.response
    return ok(c, result.data)
  })

  app.get('/date-required', (c) => {
    const result = parseDateRange(c, true)
    if (!result.ok) return result.response
    return ok(c, { from: result.from.toISOString(), to: result.to.toISOString() })
  })

  app.get('/date-optional', (c) => {
    const result = parseDateRange(c, false)
    if (!result.ok) return result.response
    return ok(c, { from: result.from?.toISOString() ?? null, to: result.to?.toISOString() ?? null })
  })

  return app
}

describe('ok()', () => {
  const app = createTestApp()

  it('returns { success: true, data } with 200 by default', async () => {
    const res = await app.request('/ok')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: { id: 1, name: 'test' } })
  })

  it('returns custom status code', async () => {
    const res = await app.request('/ok-201')

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: { id: 1 } })
  })
})

describe('fail()', () => {
  const app = createTestApp()

  it('returns { success: false, error } with given status', async () => {
    const res = await app.request('/fail-400')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'bad request' })
  })

  it('works with 404', async () => {
    const res = await app.request('/fail-404')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'not found' })
  })

  it('spreads extra fields into the response', async () => {
    const res = await app.request('/fail-extras')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({
      success: false,
      error: 'rule violated',
      code: 'RULE_X',
      details: { required: 6 },
    })
  })
})

describe('parseBody()', () => {
  const app = createTestApp()

  it('returns parsed data on valid input', async () => {
    const res = await app.request('/parse-body', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', age: 30 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: { name: 'Alice', age: 30 } })
  })

  it('returns 400 with flattened field errors on invalid input', async () => {
    const res = await app.request('/parse-body', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error.name).toBeDefined()
    expect(body.error.age).toBeDefined()
  })
})

describe('parseDateRange()', () => {
  const app = createTestApp()

  it('returns from and to on valid required params', async () => {
    const from = '2026-05-01T10:00:00Z'
    const to = '2026-05-02T10:00:00Z'
    const res = await app.request(
      `/date-required?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(new Date(body.data.from).getTime()).toBe(new Date(from).getTime())
    expect(new Date(body.data.to).getTime()).toBe(new Date(to).getTime())
  })

  it('returns 400 when required params are missing', async () => {
    const res = await app.request('/date-required')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('"from" and "to"')
  })

  it('returns 400 on invalid date strings', async () => {
    const res = await app.request('/date-required?from=bad&to=also-bad')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('valid ISO dates')
  })

  it('returns 400 when to is before from', async () => {
    const from = '2026-05-02T10:00:00Z'
    const to = '2026-05-01T10:00:00Z'
    const res = await app.request(
      `/date-required?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('"to" must be after "from"')
  })

  it('returns 400 when only from is provided (required)', async () => {
    const res = await app.request('/date-required?from=2026-05-01T10:00:00Z')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('returns nulls when optional params are absent', async () => {
    const res = await app.request('/date-optional')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.from).toBeNull()
    expect(body.data.to).toBeNull()
  })

  it('returns 400 when only one optional param is provided', async () => {
    const res = await app.request('/date-optional?from=2026-05-01T10:00:00Z')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('parses valid optional params', async () => {
    const from = '2026-05-01T10:00:00Z'
    const to = '2026-05-02T10:00:00Z'
    const res = await app.request(
      `/date-optional?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(new Date(body.data.from).getTime()).toBe(new Date(from).getTime())
    expect(new Date(body.data.to).getTime()).toBe(new Date(to).getTime())
  })
})
