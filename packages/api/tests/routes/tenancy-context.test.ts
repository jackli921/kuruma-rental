import { SignJWT } from 'jose'
import { beforeAll, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { Vehicle } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

// End-to-end context test: a Bearer JWT carrying `operatorId` (exactly as
// web's getApiToken mints it) must travel HTTP → verifyJwt → toCallerContext →
// route → repo and scope the read to that tenant. Proves the JWT-to-context hop
// the slice depends on; DB-level isolation is covered separately in
// tests/integration/tenancy-isolation.test.ts. In-memory repos keep this fast
// and deterministic (no pagination/seed-collision noise).

const vehicleFields = (
  operatorId: string,
  name: string,
): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  classId: null,
  name,
  description: null,
  photos: [],
  seats: 5,
  transmission: 'AUTO',
  fuelType: null,
  licensePlate: null,
  status: 'AVAILABLE',
  bufferMinutes: 60,
  minRentalHours: null,
  maxRentalHours: null,
  advanceBookingHours: null,
  make: null,
  model: null,
  year: null,
  color: null,
  dailyRateJpy: 5000,
  hourlyRateJpy: null,
  shakenExpiryDate: null,
  insuranceExpiryDate: null,
})

async function bearer(payload: Record<string, unknown>): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Authorization: `Bearer ${token}` }
}

describe('operatorId flows from JWT into the request context', () => {
  let app: ReturnType<typeof createApp>
  let vehicleAId: string
  let vehicleBId: string

  beforeAll(async () => {
    setupAuthEnv()
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
    const a = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleFields('op_a', 'Car A'))
    const b = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleFields('op_b', 'Car B'))
    vehicleAId = a.id
    vehicleBId = b.id
    app = createApp({ vehicleRepo, bookingRepo, availabilityRepo })
  })

  test('OPERATOR_OWNER JWT scopes GET /vehicles to its own tenant', async () => {
    const res = await app.request('/vehicles', {
      headers: await bearer({ sub: 'owner-a', role: 'OPERATOR_OWNER', operatorId: 'op_a' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.data.map((v: Vehicle) => v.id)
    expect(ids).toContain(vehicleAId)
    expect(ids).not.toContain(vehicleBId)
  })

  test('OPERATOR_OWNER JWT with no operatorId claim sees nothing (fail-closed)', async () => {
    const res = await app.request('/vehicles', {
      headers: await bearer({ sub: 'owner-x', role: 'OPERATOR_OWNER' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(0)
  })

  test('bypass (ADMIN) JWT sees every tenant — confirms scoping is operatorId-driven', async () => {
    const res = await app.request('/vehicles', {
      headers: await bearer({ sub: 'admin-1', role: 'ADMIN' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.data.map((v: Vehicle) => v.id)
    expect(ids).toContain(vehicleAId)
    expect(ids).toContain(vehicleBId)
  })
})
