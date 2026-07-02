import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryAddOnRepository } from '../../src/repositories/in-memory'
import { createAddOnRoutes } from '../../src/routes/add-ons'
import { AddOnService } from '../../src/services/add-on'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

function mountFor(repo: InMemoryAddOnRepository, role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createAddOnRoutes(new AddOnService(repo), testResolveWriteOperatorId()))
  return app
}

function body(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ name: 'Baby Seat', priceJpy: 1500, ...extra })
}

const POST = (app: Hono, b = body()) =>
  app.request('/add-ons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: b,
  })

describe('Add-on routes — auth', () => {
  it('401 when unauthenticated (no user, no token)', async () => {
    const app = new Hono()
    app.route(
      '/',
      createAddOnRoutes(
        new AddOnService(new InMemoryAddOnRepository()),
        testResolveWriteOperatorId(),
      ),
    )
    const res = await app.request('/add-ons')
    expect(res.status).toBe(401)
  })

  // [P0] add-ons are operator-private — RENTER/PARTNER must be rejected at the
  // route (403), NOT served the full cross-operator config.
  it('403 for a RENTER on list and create', async () => {
    const repo = new InMemoryAddOnRepository()
    const renter = mountFor(repo, 'RENTER')
    expect((await renter.request('/add-ons')).status).toBe(403)
    expect((await POST(renter)).status).toBe(403)
  })

  it('[P0] 403 for a PARTNER read (operator-private, not public catalog)', async () => {
    const repo = new InMemoryAddOnRepository()
    const partner = mountFor(repo, 'PARTNER')
    expect((await partner.request('/add-ons')).status).toBe(403)
  })
})

describe('Add-on routes — operator CRUD', () => {
  it('lets an OPERATOR_STAFF create an add-on stamped with its own operator', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_STAFF', OP_A))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.operatorId).toBe(OP_A)
    // Catalog i18n (slice 2): responses carry the resolved template name. A
    // legacy free-text create (templateId null) resolves back to the name column.
    expect(data.resolvedName).toBe('Baby Seat')
    expect(data.priceJpy).toBe(1500)
    expect(data.status).toBe('ACTIVE')
  })

  it('lists only the caller operator add-ons', async () => {
    const repo = new InMemoryAddOnRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ name: 'B Seat' }))
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/add-ons')
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })

  it('rejects a duplicate name within the operator with 409', async () => {
    const repo = new InMemoryAddOnRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    await POST(app)
    expect((await POST(app)).status).toBe(409)
  })

  it('returns 400 for an invalid body (missing priceJpy)', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      JSON.stringify({ name: 'No price' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for a negative priceJpy', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A), body({ priceJpy: -1 }))
    expect(res.status).toBe(400)
  })

  it('403 fail-closed when an OPERATOR_OWNER has no operatorId', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_OWNER'))
    expect(res.status).toBe(403)
  })

  it('returns 404 (not 403) when reaching another operator add-on by id', async () => {
    const repo = new InMemoryAddOnRepository()
    const created = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const intruder = mountFor(repo, 'OPERATOR_OWNER', OP_B)
    expect((await intruder.request(`/add-ons/${created.data.id}`)).status).toBe(404)
    expect(
      (
        await intruder.request(`/add-ons/${created.data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Hijack' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (await intruder.request(`/add-ons/${created.data.id}`, { method: 'DELETE' })).status,
    ).toBe(404)
  })

  it('archives an owned add-on via DELETE', async () => {
    const repo = new InMemoryAddOnRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (await POST(app)).json()
    const res = await app.request(`/add-ons/${created.data.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('ARCHIVED')
  })

  it('drops a stray ?operatorId for an operator caller (cannot widen scope)', async () => {
    const repo = new InMemoryAddOnRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ name: 'B Seat' }))
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request(`/add-ons?operatorId=${OP_B}`)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })
})

describe('Add-on routes — platform-admin scoping (bypass-precedence)', () => {
  async function seedTwoOperators() {
    const repo = new InMemoryAddOnRepository()
    const a = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const b = await (
      await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ name: 'B Seat' }))
    ).json()
    return { repo, a: a.data, b: b.data }
  }

  it('400 when a PLATFORM_ADMIN lists without operatorId or includeAll', async () => {
    const { repo } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/add-ons')
    expect(res.status).toBe(400)
  })

  it('?includeAll=true returns every operator add-on', async () => {
    const { repo } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/add-ons?includeAll=true')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(2)
  })

  it('?operatorId=A narrows to exactly that tenant', async () => {
    const { repo, a } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request(`/add-ons?operatorId=${OP_A}`)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(a.id)
  })

  it('400 when a PLATFORM_ADMIN creates without operatorId in the body', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(mountFor(repo, 'PLATFORM_ADMIN'))
    expect(res.status).toBe(400)
  })

  it('creates for an explicit operator when operatorId is supplied', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(mountFor(repo, 'PLATFORM_ADMIN'), body({ operatorId: OP_A }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.operatorId).toBe(OP_A)
  })
})
