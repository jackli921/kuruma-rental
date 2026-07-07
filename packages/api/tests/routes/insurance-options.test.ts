import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryInsuranceOptionRepository } from '../../src/repositories/in-memory'
import { createInsuranceOptionRoutes } from '../../src/routes/insurance-options'
import { InsuranceOptionService } from '../../src/services/insurance-option'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

function mountFor(repo: InMemoryInsuranceOptionRepository, role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route(
    '/',
    createInsuranceOptionRoutes(new InsuranceOptionService(repo), testResolveWriteOperatorId()),
  )
  return app
}

// #1437 slice 3: insurance is self-authored — POST bodies carry a nameI18n bundle.
function body(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ nameI18n: { en: 'Standard Cover' }, dailyPriceJpy: 1500, ...extra })
}

const POST = (app: Hono, b = body()) =>
  app.request('/insurance-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: b,
  })

describe('Insurance option routes — auth', () => {
  it('401 when unauthenticated (no user, no token)', async () => {
    const app = new Hono()
    app.route(
      '/',
      createInsuranceOptionRoutes(
        new InsuranceOptionService(new InMemoryInsuranceOptionRepository()),
        testResolveWriteOperatorId(),
      ),
    )
    const res = await app.request('/insurance-options')
    expect(res.status).toBe(401)
  })

  // [P0] insurance is operator-private — RENTER/PARTNER must be rejected at the
  // route (403), NOT served the full cross-operator config.
  it('403 for a RENTER on list and create', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const renter = mountFor(repo, 'RENTER')
    expect((await renter.request('/insurance-options')).status).toBe(403)
    expect((await POST(renter)).status).toBe(403)
  })

  it('[P0] 403 for a PARTNER read (operator-private, not public catalog)', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const partner = mountFor(repo, 'PARTNER')
    expect((await partner.request('/insurance-options')).status).toBe(403)
  })
})

describe('Insurance option routes — operator CRUD', () => {
  it('lets an OPERATOR_STAFF create an option stamped with its own operator', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_STAFF', OP_A), body({ deductibleJpy: 150000 }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.operatorId).toBe(OP_A)
    expect(data.name).toBe('Standard Cover')
    expect(data.nameI18n).toEqual({ en: 'Standard Cover' })
    expect(data.dailyPriceJpy).toBe(1500)
    expect(data.deductibleJpy).toBe(150000)
    expect(data.status).toBe('ACTIVE')
  })

  it('lists only the caller operator options', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ nameI18n: { en: 'B Cover' } }))
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/insurance-options')
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })

  it('rejects a duplicate name within the operator with 409', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    await POST(app)
    expect((await POST(app)).status).toBe(409)
  })

  it('returns 400 for an invalid body (missing dailyPriceJpy)', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      JSON.stringify({ nameI18n: { en: 'No price' } }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for a negative dailyPriceJpy', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A), body({ dailyPriceJpy: -1 }))
    expect(res.status).toBe(400)
  })

  it('403 fail-closed when an OPERATOR_OWNER has no operatorId', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_OWNER'))
    expect(res.status).toBe(403)
  })

  it('returns 404 (not 403) when reaching another operator option by id', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const created = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const intruder = mountFor(repo, 'OPERATOR_OWNER', OP_B)
    expect((await intruder.request(`/insurance-options/${created.data.id}`)).status).toBe(404)
    expect(
      (
        await intruder.request(`/insurance-options/${created.data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nameI18n: { en: 'Hijack' } }),
        })
      ).status,
    ).toBe(404)
    expect(
      (await intruder.request(`/insurance-options/${created.data.id}`, { method: 'DELETE' }))
        .status,
    ).toBe(404)
  })

  it('archives an owned option via DELETE', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (await POST(app)).json()
    const res = await app.request(`/insurance-options/${created.data.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('ARCHIVED')
  })

  it('drops a stray ?operatorId for an operator caller (cannot widen scope)', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ nameI18n: { en: 'B Cover' } }))
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request(
      `/insurance-options?operatorId=${OP_B}`,
    )
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })
})

describe('Insurance option routes — platform-admin scoping (bypass-precedence)', () => {
  async function seedTwoOperators() {
    const repo = new InMemoryInsuranceOptionRepository()
    const a = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const b = await (
      await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ nameI18n: { en: 'B Cover' } }))
    ).json()
    return { repo, a: a.data, b: b.data }
  }

  it('400 when a PLATFORM_ADMIN lists without operatorId or includeAll', async () => {
    const { repo } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/insurance-options')
    expect(res.status).toBe(400)
  })

  it('?includeAll=true returns every operator option', async () => {
    const { repo } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/insurance-options?includeAll=true')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(2)
  })

  it('?operatorId=A narrows to exactly that tenant', async () => {
    const { repo, a } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request(
      `/insurance-options?operatorId=${OP_A}`,
    )
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(a.id)
  })

  it('400 when a PLATFORM_ADMIN creates without operatorId in the body', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const res = await POST(mountFor(repo, 'PLATFORM_ADMIN'))
    expect(res.status).toBe(400)
  })

  it('creates for an explicit operator when operatorId is supplied', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const res = await POST(mountFor(repo, 'PLATFORM_ADMIN'), body({ operatorId: OP_A }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.operatorId).toBe(OP_A)
  })
})
