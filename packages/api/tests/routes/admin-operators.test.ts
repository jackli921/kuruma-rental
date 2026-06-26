import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
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
  )
  const operatorRepo = new InMemoryOperatorRepository()
  const app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, operatorRepo })
  return { app, operatorRepo }
}

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
