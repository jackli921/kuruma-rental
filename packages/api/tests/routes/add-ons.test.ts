import { seedId } from '@kuruma/shared/db/seed-id'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import {
  InMemoryAddOnRepository,
  InMemoryAddOnTemplateRepository,
} from '../../src/repositories/in-memory'
import { createAddOnRoutes } from '../../src/routes/add-ons'
import { AddOnService } from '../../src/services/add-on'
import { testAuthMiddleware } from '../helpers/auth'
import { fakeDescriptionTranslator } from '../helpers/fake-translator'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'
// Catalog i18n (slice 2): a create picks a platform template by id. seedId is
// v4-shaped so the seeded catalog validates; the in-memory template repo below
// pre-seeds the same ids, so this templateId resolves to an ACTIVE 'Child seat'.
const CHILD_SEAT = seedId('tmpl_child_seat')

function mountFor(repo: InMemoryAddOnRepository, role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route(
    '/',
    createAddOnRoutes(
      new AddOnService(repo, new InMemoryAddOnTemplateRepository(), fakeDescriptionTranslator()),
      testResolveWriteOperatorId(),
    ),
  )
  return app
}

function body(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ templateId: CHILD_SEAT, priceJpy: 1500, ...extra })
}

// A self-authored create carries a nameI18n bundle and NO templateId (#1437).
function selfAuthoredBody(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    nameI18n: { en: 'GPS unit', ja: 'GPS ユニット' },
    priceJpy: 1500,
    ...extra,
  })
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
        new AddOnService(
          new InMemoryAddOnRepository(),
          new InMemoryAddOnTemplateRepository(),
          fakeDescriptionTranslator(),
        ),
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
    // Catalog i18n (slice 2): a create picks a template; the response carries the
    // template name resolved to the caller locale (default en here).
    expect(data.resolvedName).toBe('Child seat')
    expect(data.priceJpy).toBe(1500)
    expect(data.status).toBe('ACTIVE')
  })

  it('lists only the caller operator add-ons', async () => {
    const repo = new InMemoryAddOnRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body())
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/add-ons')
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })

  it('rejects a duplicate template within the operator with 409', async () => {
    const repo = new InMemoryAddOnRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    await POST(app)
    expect((await POST(app)).status).toBe(409)
  })

  it('returns 400 for an invalid body (missing priceJpy)', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      JSON.stringify({ templateId: CHILD_SEAT }),
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
          body: JSON.stringify({ priceJpy: 1 }),
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
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body())
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request(`/add-ons?operatorId=${OP_B}`)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })
})

describe('Add-on routes — self-authored (#1437)', () => {
  it('creates a self-authored add-on from a nameI18n bundle (no template)', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A), selfAuthoredBody())
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.templateId).toBeNull()
    expect(data.nameI18n).toEqual({ en: 'GPS unit', ja: 'GPS ユニット' })
    // Forwarding regression guard (H1): a dropped nameI18n would leave the service
    // with neither identity → 400, so a 201 with the resolved name proves the route
    // carried the bundle through.
    expect(data.resolvedName).toBe('GPS unit')
  })

  it('resolves the self-authored name to the caller locale (?locale=ja)', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/add-ons?locale=ja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: selfAuthoredBody(),
    })
    expect(res.status).toBe(201)
    expect((await res.json()).data.resolvedName).toBe('GPS ユニット')
  })

  it('400 when a create carries BOTH a templateId and a nameI18n', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      selfAuthoredBody({ templateId: CHILD_SEAT }),
    )
    expect(res.status).toBe(400)
  })

  it('400 when a create carries NEITHER a templateId nor a nameI18n', async () => {
    const repo = new InMemoryAddOnRepository()
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      JSON.stringify({ priceJpy: 1500 }),
    )
    expect(res.status).toBe(400)
  })

  it('edits a self-authored name via PATCH nameI18n and re-resolves (D5)', async () => {
    const repo = new InMemoryAddOnRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (await POST(app, selfAuthoredBody())).json()
    const res = await app.request(`/add-ons/${created.data.id}?locale=ja`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameI18n: { en: 'GPS receiver', ja: 'GPS 受信機' } }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.resolvedName).toBe('GPS 受信機')
  })

  it('400 (not 500) when PATCHing nameI18n onto a PICKED row', async () => {
    const repo = new InMemoryAddOnRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (await POST(app)).json()
    const res = await app.request(`/add-ons/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameI18n: { en: 'My own name' } }),
    })
    expect(res.status).toBe(400)
  })
})

describe('Add-on routes — platform-admin scoping (bypass-precedence)', () => {
  async function seedTwoOperators() {
    const repo = new InMemoryAddOnRepository()
    const a = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const b = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body())).json()
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

  // #1456: PATCH/DELETE bind a bypass admin's write to the operator it picked via
  // ?operatorId= — parity with fees (#1442) and locations. No pick -> 422; wrong
  // pick -> 404 (no existence oracle); right pick -> the write applies.
  const PATCH = (app: Hono, id: string, qs = '') =>
    app.request(`/add-ons/${id}${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceJpy: 3000 }),
    })
  const DELETE = (app: Hono, id: string, qs = '') =>
    app.request(`/add-ons/${id}${qs}`, { method: 'DELETE' })

  it('422 when a PLATFORM_ADMIN edits an add-on without a picked operator', async () => {
    const { repo, a } = await seedTwoOperators()
    expect((await PATCH(mountFor(repo, 'PLATFORM_ADMIN'), a.id)).status).toBe(422)
  })

  it('404 when a PLATFORM_ADMIN edits an add-on whose picked operator does not own it', async () => {
    const { repo, a } = await seedTwoOperators()
    expect(
      (await PATCH(mountFor(repo, 'PLATFORM_ADMIN'), a.id, `?operatorId=${OP_B}`)).status,
    ).toBe(404)
  })

  it('200 when a PLATFORM_ADMIN edits an add-on bound to its owning operator', async () => {
    const { repo, a } = await seedTwoOperators()
    const res = await PATCH(mountFor(repo, 'PLATFORM_ADMIN'), a.id, `?operatorId=${OP_A}`)
    expect(res.status).toBe(200)
    expect((await res.json()).data.priceJpy).toBe(3000)
  })

  it('422 when a PLATFORM_ADMIN archives an add-on without a picked operator', async () => {
    const { repo, a } = await seedTwoOperators()
    expect((await DELETE(mountFor(repo, 'PLATFORM_ADMIN'), a.id)).status).toBe(422)
  })

  it('404 when a PLATFORM_ADMIN archives an add-on whose picked operator does not own it', async () => {
    const { repo, a } = await seedTwoOperators()
    expect(
      (await DELETE(mountFor(repo, 'PLATFORM_ADMIN'), a.id, `?operatorId=${OP_B}`)).status,
    ).toBe(404)
  })

  it('200 when a PLATFORM_ADMIN archives an add-on bound to its owning operator', async () => {
    const { repo, a } = await seedTwoOperators()
    const res = await DELETE(mountFor(repo, 'PLATFORM_ADMIN'), a.id, `?operatorId=${OP_A}`)
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('ARCHIVED')
  })
})
