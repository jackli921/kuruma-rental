import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { Vehicle } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

async function bearer(payload: Record<string, unknown>): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function makeApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    new InMemoryOperatorRepository(),
  )
  const operatorRepo = new InMemoryOperatorRepository()
  const app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, operatorRepo })
  return { app, operatorRepo, vehicleRepo }
}

const ADMIN = { sub: 'admin-1', role: 'PLATFORM_ADMIN' } as const

/** Create an operator via the existing platform-admin POST and return its id/slug. */
async function createOperator(
  app: ReturnType<typeof makeApp>['app'],
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await app.request('/admin/operators', {
    method: 'POST',
    headers: await bearer(ADMIN),
    body: JSON.stringify({ name }),
  })
  const body = (await res.json()) as { data: { id: string; slug: string } }
  return body.data
}

/** Seed a single vehicle for an operator so fleetCount has something to count. */
function seedVehicle(
  repo: InMemoryVehicleRepository,
  operatorId: string,
  over: Partial<Vehicle> = {},
): Promise<Vehicle> {
  return repo.create(SYSTEM_CONTEXT, {
    operatorId,
    classId: 'class_compact',
    pickupLocationId: null,
    name: 'Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...over,
  })
}

interface AdminOperatorRow {
  id: string
  name: string
  slug: string
  deactivatedAt: string | null
  createdAt: string
  fleetCount: number
}

describe('GET /admin/operators', () => {
  let harness: ReturnType<typeof makeApp>

  beforeEach(() => {
    harness = makeApp()
  })

  for (const role of ['OPERATOR_OWNER', 'OPERATOR_STAFF', 'RENTER', 'PARTNER'] as const) {
    test(`${role} is forbidden — the directory is platform-only (403)`, async () => {
      const res = await harness.app.request('/admin/operators', {
        headers: await bearer({ sub: `u-${role}`, role, operatorId: 'op_x' }),
      })
      expect(res.status).toBe(403)
    })
  }

  test('rejects an unauthenticated request (401)', async () => {
    const res = await harness.app.request('/admin/operators')
    expect(res.status).toBe(401)
  })

  test('PLATFORM_ADMIN sees every operator with deactivatedAt + live (non-RETIRED) fleetCount', async () => {
    const fleetCo = await createOperator(harness.app, 'Fleet Co')
    await createOperator(harness.app, 'Empty Co')
    await seedVehicle(harness.vehicleRepo, fleetCo.id)
    await seedVehicle(harness.vehicleRepo, fleetCo.id)
    await seedVehicle(harness.vehicleRepo, fleetCo.id, { status: 'RETIRED' }) // excluded from count

    const res = await harness.app.request('/admin/operators', { headers: await bearer(ADMIN) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: AdminOperatorRow[] }
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)

    const fleet = body.data.find((r) => r.id === fleetCo.id)
    const empty = body.data.find((r) => r.name === 'Empty Co')
    expect(fleet).toMatchObject({
      name: 'Fleet Co',
      slug: 'fleet-co',
      deactivatedAt: null,
      fleetCount: 2,
    })
    expect(empty).toMatchObject({ deactivatedAt: null, fleetCount: 0 })
    expect(typeof fleet?.createdAt).toBe('string')
  })
})

describe('POST /admin/operators/:id/{deactivate,reactivate}', () => {
  let harness: ReturnType<typeof makeApp>

  beforeEach(() => {
    harness = makeApp()
  })

  for (const role of ['OPERATOR_OWNER', 'OPERATOR_STAFF', 'RENTER', 'PARTNER'] as const) {
    for (const action of ['deactivate', 'reactivate'] as const) {
      test(`${role} cannot ${action} an operator (403)`, async () => {
        const res = await harness.app.request(`/admin/operators/op_x/${action}`, {
          method: 'POST',
          headers: await bearer({ sub: `u-${role}`, role, operatorId: 'op_x' }),
        })
        expect(res.status).toBe(403)
      })
    }
  }

  test('PLATFORM_ADMIN deactivate sets deactivatedAt; reactivate clears it', async () => {
    const { id } = await createOperator(harness.app, 'Toggle Co')

    const deRes = await harness.app.request(`/admin/operators/${id}/deactivate`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(deRes.status).toBe(200)
    const deBody = (await deRes.json()) as { data: { id: string; deactivatedAt: string | null } }
    expect(deBody.data.id).toBe(id)
    expect(deBody.data.deactivatedAt).not.toBeNull()

    // Admin directory lists ALL operators (so the admin can reactivate); the row
    // now carries the deactivatedAt that the UI derives "deactivated" from.
    const listRes = await harness.app.request('/admin/operators', { headers: await bearer(ADMIN) })
    const listed = ((await listRes.json()) as { data: AdminOperatorRow[] }).data.find(
      (r) => r.id === id,
    )
    expect(listed?.deactivatedAt).not.toBeNull()

    const reRes = await harness.app.request(`/admin/operators/${id}/reactivate`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(reRes.status).toBe(200)
    const reBody = (await reRes.json()) as { data: { deactivatedAt: string | null } }
    expect(reBody.data.deactivatedAt).toBeNull()
  })

  test('deactivating an unknown operator → 404', async () => {
    const res = await harness.app.request('/admin/operators/op_missing/deactivate', {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(404)
  })

  test('reactivating an unknown operator → 404', async () => {
    const res = await harness.app.request('/admin/operators/op_missing/reactivate', {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(404)
  })
})

interface OperatorSummaryBody {
  operatorId: string
  name: string
  vehicleCount: number
  vehiclesNeedingDocs: number
  vehiclesExpiringSoon: number
  totalBookings: number
  upcomingBookings: number
  lastComplianceAlertAt: string | null
}

describe('GET /admin/operators/:id/summary (#1120)', () => {
  let harness: ReturnType<typeof makeApp>

  beforeEach(() => {
    harness = makeApp()
  })

  for (const role of ['OPERATOR_OWNER', 'OPERATOR_STAFF', 'RENTER', 'PARTNER'] as const) {
    test(`${role} is forbidden — the summary is platform-only (403)`, async () => {
      const res = await harness.app.request('/admin/operators/op_x/summary', {
        headers: await bearer({ sub: `u-${role}`, role, operatorId: 'op_x' }),
      })
      expect(res.status).toBe(403)
    })
  }

  test('rejects an unauthenticated request (401)', async () => {
    const res = await harness.app.request('/admin/operators/op_x/summary')
    expect(res.status).toBe(401)
  })

  test('unknown operator id → 404', async () => {
    const res = await harness.app.request('/admin/operators/op_missing/summary', {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(404)
  })

  test('PLATFORM_ADMIN gets the per-operator roll-up over its live fleet', async () => {
    const { id } = await createOperator(harness.app, 'Summary Co')
    // both docs in-date → fine
    await seedVehicle(harness.vehicleRepo, id, {
      shakenExpiryDate: '2027-01-01',
      insuranceExpiryDate: '2027-01-01',
    })
    // shaken missing (insurance fine) → UNKNOWN → needs docs
    await seedVehicle(harness.vehicleRepo, id, {
      shakenExpiryDate: null,
      insuranceExpiryDate: '2027-01-01',
    })
    await seedVehicle(harness.vehicleRepo, id, { status: 'RETIRED' }) // excluded

    const res = await harness.app.request(`/admin/operators/${id}/summary`, {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: OperatorSummaryBody }
    expect(body.success).toBe(true)
    expect(body.data).toEqual({
      operatorId: id,
      name: 'Summary Co',
      vehicleCount: 2,
      vehiclesNeedingDocs: 1,
      vehiclesExpiringSoon: 0,
      totalBookings: 0,
      upcomingBookings: 0,
      lastComplianceAlertAt: null,
    })
  })
})

describe('POST /admin/operators', () => {
  let app: ReturnType<typeof makeApp>['app']

  beforeEach(() => {
    app = makeApp().app
  })

  test('PLATFORM_ADMIN creates an operator with a derived slug (201)', async () => {
    const res = await app.request('/admin/operators', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({ name: 'Best Car Rental' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toMatchObject({ name: 'Best Car Rental', slug: 'best-car-rental' })
    expect(body.data.id).toBeTruthy()
  })

  test('OPERATOR_OWNER is forbidden (403)', async () => {
    const res = await app.request('/admin/operators', {
      method: 'POST',
      headers: await bearer({ sub: 'owner-1', role: 'OPERATOR_OWNER', operatorId: 'op_1' }),
      body: JSON.stringify({ name: 'Sneaky' }),
    })
    expect(res.status).toBe(403)
  })

  test('legacy ADMIN is forbidden — operator creation is platform-only (403)', async () => {
    const res = await app.request('/admin/operators', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-legacy', role: 'ADMIN' }),
      body: JSON.stringify({ name: 'Legacy' }),
    })
    expect(res.status).toBe(403)
  })

  test('rejects a missing name (400)', async () => {
    const res = await app.request('/admin/operators', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test('rejects an unauthenticated request (401)', async () => {
    const res = await app.request('/admin/operators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(res.status).toBe(401)
  })
})
