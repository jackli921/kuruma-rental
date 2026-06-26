import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { CallerContext } from '../middleware/auth'
import { resolveOperatorIdForWrite } from '../tenancy'
import { parseScopedCreate } from './helpers'

// #1107 (audit L4): the write-route schema-selection + operatorId-resolution
// branch, deduplicated. A bypass caller names the target operator in the body;
// an operator caller is stamped with its own tenant and a body operatorId is
// ignored. We drive the real helper through a real Hono app + the real
// `resolveOperatorIdForWrite` so the wiring (not a mock) is what's asserted.

const operatorSchema = z.object({ name: z.string() })
const adminSchema = z.object({ name: z.string(), operatorId: z.string() })

const app = (ctx: CallerContext) => {
  const a = new Hono()
  a.post('/x', async (c) => {
    const r = await parseScopedCreate(
      c,
      ctx,
      { operatorSchema, adminSchema },
      resolveOperatorIdForWrite,
    )
    if (!r.ok) return r.response
    return c.json({ name: r.data.name, operatorId: r.operatorId })
  })
  return a
}

const post = (ctx: CallerContext, body: unknown) =>
  app(ctx).request('/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const OPERATOR: CallerContext = { userId: 'o1', role: 'OPERATOR_OWNER', operatorId: 'op1' }
const ADMIN: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }

describe('parseScopedCreate (#1107)', () => {
  it('operator caller is stamped with its own tenant, ignoring a body operatorId', async () => {
    const res = await post(OPERATOR, { name: 'a', operatorId: 'op-evil' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'a', operatorId: 'op1' })
  })

  it('bypass caller resolves the target operator from the body', async () => {
    const res = await post(ADMIN, { name: 'a', operatorId: 'op2' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'a', operatorId: 'op2' })
  })

  it('bypass caller without a body operatorId is a 400 (admin schema requires it)', async () => {
    const res = await post(ADMIN, { name: 'a' })
    expect(res.status).toBe(400)
  })

  it('operator caller with an invalid body is a 400 (operator schema)', async () => {
    const res = await post(OPERATOR, { notName: 'a' })
    expect(res.status).toBe(400)
  })
})
