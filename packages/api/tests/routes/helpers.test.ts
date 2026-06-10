import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  exceedsContentLength,
  fail,
  ok,
  parseBody,
  parseDateRange,
  parseLimit,
  parsePagination,
  rejectOversizedBody,
} from '../../src/routes/helpers'

const GUARD_MAX_BYTES = 100

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

  app.get('/limit-only', (c) => {
    const result = parseLimit(c, { defaultLimit: 20 })
    if (!result.ok) return result.response
    return ok(c, { limit: result.limit })
  })

  app.get('/paginate', (c) => {
    const result = parsePagination(c)
    if (!result.ok) return result.response
    return ok(c, { limit: result.limit, offset: result.offset })
  })

  app.get('/paginate-custom', (c) => {
    const result = parsePagination(c, { defaultLimit: 10, maxLimit: 50 })
    if (!result.ok) return result.response
    return ok(c, { limit: result.limit, offset: result.offset })
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

  app.post('/guarded', (c) => rejectOversizedBody(c, GUARD_MAX_BYTES) ?? ok(c, { passed: true }))

  return app
}

describe('exceedsContentLength()', () => {
  it('is true only when a valid length is strictly above the max', () => {
    expect(exceedsContentLength('101', GUARD_MAX_BYTES)).toBe(true)
  })

  it('is false at the exact boundary (equal is allowed)', () => {
    expect(exceedsContentLength('100', GUARD_MAX_BYTES)).toBe(false)
  })

  it('is false below the max', () => {
    expect(exceedsContentLength('99', GUARD_MAX_BYTES)).toBe(false)
  })

  it('is false when the header is absent (cannot pre-check; service backstops)', () => {
    expect(exceedsContentLength(undefined, GUARD_MAX_BYTES)).toBe(false)
    expect(exceedsContentLength(null, GUARD_MAX_BYTES)).toBe(false)
    expect(exceedsContentLength('', GUARD_MAX_BYTES)).toBe(false)
  })

  it('is false for a malformed header rather than trusting a partial parse', () => {
    expect(exceedsContentLength('999abc', GUARD_MAX_BYTES)).toBe(false)
    expect(exceedsContentLength('1.5', GUARD_MAX_BYTES)).toBe(false)
    expect(exceedsContentLength('-1', GUARD_MAX_BYTES)).toBe(false)
  })
})

describe('rejectOversizedBody()', () => {
  const app = createTestApp()

  it('returns 413 with an error envelope when Content-Length exceeds the max', async () => {
    const res = await app.request('/guarded', {
      method: 'POST',
      headers: { 'content-length': '101' },
    })

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ success: false, error: 'Request body too large' })
  })

  it('passes through when Content-Length is within the max', async () => {
    const res = await app.request('/guarded', {
      method: 'POST',
      headers: { 'content-length': '100' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { passed: true } })
  })

  it('passes through when Content-Length is absent (chunked/streamed bodies)', async () => {
    const res = await app.request('/guarded', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { passed: true } })
  })
})

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

describe('parseLimit()', () => {
  const app = createTestApp()

  it('returns defaultLimit when no param provided', async () => {
    const res = await app.request('/limit-only')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ limit: 20 })
  })

  it('parses valid limit', async () => {
    const res = await app.request('/limit-only?limit=50')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ limit: 50 })
  })

  it('returns 400 for invalid limit', async () => {
    const res = await app.request('/limit-only?limit=0')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('limit must be between 1 and 100')
  })

  it('ignores offset query param (no offset in result)', async () => {
    const res = await app.request('/limit-only?limit=10&offset=999')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ limit: 10 })
    expect(body.data.offset).toBeUndefined()
  })
})

describe('parsePagination()', () => {
  const app = createTestApp()

  it('returns defaults when no params provided', async () => {
    const res = await app.request('/paginate')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ limit: 25, offset: 0 })
  })

  it('parses valid limit and offset', async () => {
    const res = await app.request('/paginate?limit=10&offset=20')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ limit: 10, offset: 20 })
  })

  it('returns 400 for limit below 1', async () => {
    const res = await app.request('/paginate?limit=0')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('limit must be between 1 and 100')
  })

  it('returns 400 for limit above max', async () => {
    const res = await app.request('/paginate?limit=101')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('limit must be between 1 and 100')
  })

  it('returns 400 for NaN limit', async () => {
    const res = await app.request('/paginate?limit=abc')
    expect(res.status).toBe(400)
  })

  it('returns 400 for negative offset', async () => {
    const res = await app.request('/paginate?offset=-1')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('offset must be a non-negative integer (max 1000000)')
  })

  it('returns 400 for offset above MAX_OFFSET', async () => {
    const res = await app.request('/paginate?offset=1000001')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('offset must be a non-negative integer (max 1000000)')
  })

  it('rejects lenient parseInt input for limit ("10abc" must not parse to 10)', async () => {
    const res = await app.request('/paginate?limit=10abc')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('limit must be between 1 and 100')
  })

  it('rejects lenient parseInt input for offset ("5xyz" must not parse to 5)', async () => {
    const res = await app.request('/paginate?offset=5xyz')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('offset must be a non-negative integer (max 1000000)')
  })

  it('rejects decimal input for limit ("1.5")', async () => {
    const res = await app.request('/paginate?limit=1.5')
    expect(res.status).toBe(400)
  })

  it('rejects scientific notation for offset ("1e5")', async () => {
    const res = await app.request('/paginate?offset=1e5')
    expect(res.status).toBe(400)
  })

  it('respects custom defaults and maxLimit', async () => {
    const res = await app.request('/paginate-custom')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ limit: 10, offset: 0 })
  })

  it('returns 400 when limit exceeds custom maxLimit', async () => {
    const res = await app.request('/paginate-custom?limit=51')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('limit must be between 1 and 50')
  })
})
