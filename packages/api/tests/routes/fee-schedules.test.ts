import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryFeeScheduleRepository } from '../../src/repositories/in-memory'
import { createFeeScheduleRoutes } from '../../src/routes/fee-schedules'
import { FeeScheduleService } from '../../src/services/fee-schedule'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

function mountFor(repo: InMemoryFeeScheduleRepository, role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route(
    '/',
    createFeeScheduleRoutes(new FeeScheduleService(repo), testResolveWriteOperatorId()),
  )
  return app
}

function body(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ feeType: 'CLEANING_FLAT', unit: 'FLAT', amountJpy: 3000, ...extra })
}

const POST = (app: Hono, b = body()) =>
  app.request('/fee-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: b,
  })

describe('Fee-schedule routes — auth', () => {
  it('401 when unauthenticated', async () => {
    const app = new Hono()
    app.route(
      '/',
      createFeeScheduleRoutes(
        new FeeScheduleService(new InMemoryFeeScheduleRepository()),
        testResolveWriteOperatorId(),
      ),
    )
    expect((await app.request('/fee-schedules')).status).toBe(401)
  })

  it('403 for a RENTER on list and create', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const renter = mountFor(repo, 'RENTER')
    expect((await renter.request('/fee-schedules')).status).toBe(403)
    expect((await POST(renter)).status).toBe(403)
  })

  it('403 for a PARTNER on list (private config, [P0])', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const partner = mountFor(repo, 'PARTNER')
    expect((await partner.request('/fee-schedules?includeAll=true')).status).toBe(403)
  })
})

describe('Fee-schedule routes — operator CRUD', () => {
  it('lets an OPERATOR_STAFF create a fee stamped with its own operator', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_STAFF', OP_A))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.operatorId).toBe(OP_A)
    expect(data.feeType).toBe('CLEANING_FLAT')
    expect(data.unit).toBe('FLAT')
    expect(data.amountJpy).toBe(3000)
    expect(data.status).toBe('ACTIVE')
  })

  it('lists only the caller operator fees', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B))
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/fee-schedules')
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })

  it('returns 400 for an incoherent fee-type/unit on create', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      body({ feeType: 'OVERTIME_HOURLY', unit: 'FLAT' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for a missing required field (amount)', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      JSON.stringify({ feeType: 'CLEANING_FLAT', unit: 'FLAT' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 409 for a duplicate active (type, scope)', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    await POST(app)
    expect((await POST(app)).status).toBe(409)
  })

  it('403 fail-closed when an OPERATOR_OWNER has no operatorId', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    expect((await POST(mountFor(repo, 'OPERATOR_OWNER'))).status).toBe(403)
  })

  it('returns 400 on a PATCH that breaks merged-value coherence (unit-only)', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (
      await POST(app, body({ feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 500 }))
    ).json()
    const res = await app.request(`/fee-schedules/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit: 'FLAT' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 (not 403) when reaching another operator fee by id', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const created = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const intruder = mountFor(repo, 'OPERATOR_OWNER', OP_B)
    expect((await intruder.request(`/fee-schedules/${created.data.id}`)).status).toBe(404)
    expect(
      (
        await intruder.request(`/fee-schedules/${created.data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amountJpy: 1 }),
        })
      ).status,
    ).toBe(404)
    expect(
      (await intruder.request(`/fee-schedules/${created.data.id}`, { method: 'DELETE' })).status,
    ).toBe(404)
  })

  it('archives an owned fee via DELETE', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (await POST(app)).json()
    const res = await app.request(`/fee-schedules/${created.data.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('ARCHIVED')
  })

  it('drops a stray ?operatorId for an operator caller (cannot widen scope)', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B))
    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request(
      `/fee-schedules?operatorId=${OP_B}`,
    )
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })
})

describe('Fee-schedule routes — platform-admin scoping (bypass-precedence)', () => {
  async function seedTwoOperators() {
    const repo = new InMemoryFeeScheduleRepository()
    const a = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const b = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B))).json()
    return { repo, a: a.data, b: b.data }
  }

  it('400 when a PLATFORM_ADMIN lists without operatorId or includeAll', async () => {
    const { repo } = await seedTwoOperators()
    expect((await mountFor(repo, 'PLATFORM_ADMIN').request('/fee-schedules')).status).toBe(400)
  })

  it('?includeAll=true returns every operator fee', async () => {
    const { repo } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/fee-schedules?includeAll=true')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(2)
  })

  it('?operatorId=A narrows to exactly that tenant', async () => {
    const { repo, a } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request(`/fee-schedules?operatorId=${OP_A}`)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(a.id)
  })

  it('400 when a PLATFORM_ADMIN creates without operatorId in the body', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    expect((await POST(mountFor(repo, 'PLATFORM_ADMIN'))).status).toBe(400)
  })

  it('creates for an explicit operator when operatorId is supplied', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const res = await POST(mountFor(repo, 'PLATFORM_ADMIN'), body({ operatorId: OP_A }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.operatorId).toBe(OP_A)
  })
})

describe('Fee-schedule routes — invalid vehicleClassId (composite FK -> 400)', () => {
  // The composite FK only fires against real Postgres; simulate the repo throwing
  // it so the route's service-error mapping (400 + INVALID_VEHICLE_CLASS code) is
  // proven without a DB. The integration suite proves the real 23503 maps too.
  const fkViolation = () =>
    Object.assign(new Error('violates foreign key constraint'), {
      code: '23503',
      constraint_name: 'fee_schedules_operator_class_fk',
    })
  const BAD_CLASS = '00000000-0000-0000-0000-000000000000'

  it('POST returns 400 + INVALID_VEHICLE_CLASS when the class FK is violated', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    vi.spyOn(repo, 'create').mockRejectedValue(fkViolation())
    const res = await POST(
      mountFor(repo, 'OPERATOR_OWNER', OP_A),
      body({ feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', vehicleClassId: BAD_CLASS }),
    )
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.success).toBe(false)
    expect(j.code).toBe('INVALID_VEHICLE_CLASS')
  })

  it('PATCH returns 400 + INVALID_VEHICLE_CLASS when setting a bad vehicleClassId', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (await POST(app)).json()
    vi.spyOn(repo, 'update').mockRejectedValue(fkViolation())
    const res = await app.request(`/fee-schedules/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleClassId: BAD_CLASS }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_VEHICLE_CLASS')
  })
})
