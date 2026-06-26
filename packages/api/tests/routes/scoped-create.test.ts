import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { CallerContext } from '../../src/auth/context'
import { parseScopedCreate } from '../../src/routes/helpers'
import type { ResolveWriteOperatorId } from '../../src/tenancy'

// The operator schema has NO operatorId; the admin (bypass) schema requires one.
// This mirrors the real config create/platformAdminCreate pairs: an operator
// caller can never name a tenant, a bypass caller must.
const operatorSchema = z.object({ name: z.string() }).strict()
const adminSchema = z.object({ name: z.string(), operatorId: z.string() }).strict()

const OPERATOR_CTX: CallerContext = {
  userId: 'u-1',
  role: 'OPERATOR_OWNER',
  operatorId: 'op-self',
  bypassScope: false,
}
const ADMIN_CTX: CallerContext = { userId: 'a-1', role: 'PLATFORM_ADMIN', bypassScope: true }

// Records every (role, inputOperatorId) the helper hands the resolver, so a test
// can prove WHICH operatorId the helper trusted — server tenant vs request body.
function spyResolver() {
  const calls: Array<{ role: string; input: string | undefined }> = []
  const resolve: ResolveWriteOperatorId = async (ctx, input) => {
    calls.push({ role: ctx.role, input })
    return ctx.operatorId ?? input ?? 'UNRESOLVED'
  }
  return { calls, resolve }
}

function appWith(ctx: CallerContext, resolve: ResolveWriteOperatorId) {
  return new Hono().post('/x', async (c) => {
    const parsed = await parseScopedCreate(
      c,
      ctx,
      { operator: operatorSchema, admin: adminSchema },
      resolve,
    )
    if (!parsed.ok) return parsed.response
    return c.json({ data: parsed.data, operatorId: parsed.operatorId })
  })
}

function post(app: Hono, body: unknown) {
  return app.request('/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('parseScopedCreate()', () => {
  it('operator caller: parses with the operator schema and derives operatorId from the tenant, never the body', async () => {
    const { calls, resolve } = spyResolver()
    const res = await post(appWith(OPERATOR_CTX, resolve), { name: 'Std' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { name: 'Std' }, operatorId: 'op-self' })
    // The security invariant: the operator path resolved WITHOUT a body operatorId.
    expect(calls).toEqual([{ role: 'OPERATOR_OWNER', input: undefined }])
  })

  it('operator caller cannot smuggle a foreign operatorId: the strict operator schema rejects it (400)', async () => {
    const { calls, resolve } = spyResolver()
    const res = await post(appWith(OPERATOR_CTX, resolve), { name: 'Std', operatorId: 'op-victim' })

    expect(res.status).toBe(400)
    // Rejected before any tenant resolution — no spoof reaches the resolver.
    expect(calls).toHaveLength(0)
  })

  it('bypass caller: parses with the admin schema and resolves the body-named operatorId', async () => {
    const { calls, resolve } = spyResolver()
    const res = await post(appWith(ADMIN_CTX, resolve), { name: 'Adm', operatorId: 'op-target' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ operatorId: 'op-target' })
    expect(calls).toEqual([{ role: 'PLATFORM_ADMIN', input: 'op-target' }])
  })

  it('bypass caller must name a target operator: a body without operatorId is a 400', async () => {
    const { calls, resolve } = spyResolver()
    const res = await post(appWith(ADMIN_CTX, resolve), { name: 'Adm' })

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('a body that fails the operator schema short-circuits to 400 without resolving', async () => {
    const { calls, resolve } = spyResolver()
    const res = await post(appWith(OPERATOR_CTX, resolve), { name: 42 })

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})
