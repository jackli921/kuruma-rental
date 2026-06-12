import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryLocationRepository } from '../../src/repositories/in-memory'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { createLocationRoutes } from '../../src/routes/locations'
import type { Geocoder } from '../../src/services/geocoding/types'
import { LocationService } from '../../src/services/location'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

// These route tests exercise auth/validation/routing, not geocoding; a stub
// Geocoder keeps the write path total. The #531 matrix is covered in the
// service test, and the provider-swap contract in the createApp DI test.
const nullGeocoder: Geocoder = { geocode: async () => null }

function mountFor(
  repo: InMemoryLocationRepository,
  role: UserRole,
  operatorId?: string,
  bookingRepo: InMemoryBookingRepository = new InMemoryBookingRepository(),
) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route(
    '/',
    createLocationRoutes(
      new LocationService(repo, bookingRepo, nullGeocoder),
      testResolveWriteOperatorId(),
    ),
  )
  return app
}

function body(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ name: 'Osaka Namba', address: '1-2-3 Namba', ...extra })
}

const POST = (app: Hono, b = body()) =>
  app.request('/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: b,
  })

describe('Location routes — auth', () => {
  it('401 when unauthenticated (no user, no token)', async () => {
    const app = new Hono()
    app.route(
      '/',
      createLocationRoutes(
        new LocationService(
          new InMemoryLocationRepository(),
          new InMemoryBookingRepository(),
          nullGeocoder,
        ),
        testResolveWriteOperatorId(),
      ),
    )
    const res = await app.request('/locations')
    expect(res.status).toBe(401)
  })

  it('403 for a RENTER on list and create', async () => {
    const repo = new InMemoryLocationRepository()
    const renter = mountFor(repo, 'RENTER')
    expect((await renter.request('/locations')).status).toBe(403)
    expect((await POST(renter)).status).toBe(403)
  })
})

describe('Location routes — operator CRUD', () => {
  it('lets an OPERATOR_STAFF create a location stamped with its own operator', async () => {
    const repo = new InMemoryLocationRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_STAFF', OP_A))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.operatorId).toBe(OP_A)
    expect(data.name).toBe('Osaka Namba')
    expect(data.defaultTurnaroundMinutes).toBe(2880)
    expect(data.timezone).toBe('Asia/Tokyo')
  })

  it('lists only the caller operator locations', async () => {
    const repo = new InMemoryLocationRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ name: 'B Store' }))

    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/locations')
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })

  it('rejects a duplicate name within the operator with 409', async () => {
    const repo = new InMemoryLocationRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    await POST(app)
    expect((await POST(app)).status).toBe(409)
  })

  it('returns 400 for an invalid body (missing address)', async () => {
    const repo = new InMemoryLocationRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A), JSON.stringify({ name: 'X' }))
    expect(res.status).toBe(400)
  })

  it('403 fail-closed when an OPERATOR_OWNER has no operatorId', async () => {
    const repo = new InMemoryLocationRepository()
    const res = await POST(mountFor(repo, 'OPERATOR_OWNER'))
    expect(res.status).toBe(403)
  })

  it('returns 404 (not 403) when reaching another operator location by id', async () => {
    const repo = new InMemoryLocationRepository()
    const created = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const intruder = mountFor(repo, 'OPERATOR_OWNER', OP_B)

    expect((await intruder.request(`/locations/${created.data.id}`)).status).toBe(404)
    expect(
      (
        await intruder.request(`/locations/${created.data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Hijack' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (await intruder.request(`/locations/${created.data.id}`, { method: 'DELETE' })).status,
    ).toBe(404)
  })

  it('archives an owned location via DELETE', async () => {
    const repo = new InMemoryLocationRepository()
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)
    const created = await (await POST(app)).json()
    const res = await app.request(`/locations/${created.data.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('ARCHIVED')
  })

  it('drops a stray ?operatorId for an operator caller (cannot widen scope)', async () => {
    const repo = new InMemoryLocationRepository()
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))
    await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ name: 'B Store' }))

    const res = await mountFor(repo, 'OPERATOR_OWNER', OP_A).request(
      `/locations?operatorId=${OP_B}`,
    )
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].operatorId).toBe(OP_A)
  })
})

describe('Location routes — platform-admin scoping', () => {
  // Seed one location per operator through operator apps sharing the repo.
  async function seedTwoOperators() {
    const repo = new InMemoryLocationRepository()
    const a = await (await POST(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
    const b = await (
      await POST(mountFor(repo, 'OPERATOR_OWNER', OP_B), body({ name: 'B Store' }))
    ).json()
    return { repo, a: a.data, b: b.data }
  }

  it('400 when a PLATFORM_ADMIN lists without operatorId or includeAll', async () => {
    const { repo } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/locations')
    expect(res.status).toBe(400)
  })

  it('?includeAll=true returns every operator location', async () => {
    const { repo } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/locations?includeAll=true')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(2)
  })

  it('?operatorId=X narrows to exactly that tenant', async () => {
    const { repo, a } = await seedTwoOperators()
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request(`/locations?operatorId=${OP_A}`)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(a.id)
  })

  it('400 when a PLATFORM_ADMIN creates without operatorId in the body', async () => {
    const repo = new InMemoryLocationRepository()
    const res = await POST(mountFor(repo, 'PLATFORM_ADMIN'))
    expect(res.status).toBe(400)
  })

  it('creates for an explicit operator when operatorId is supplied', async () => {
    const repo = new InMemoryLocationRepository()
    const res = await POST(mountFor(repo, 'PLATFORM_ADMIN'), body({ operatorId: OP_A }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.operatorId).toBe(OP_A)
  })
})
