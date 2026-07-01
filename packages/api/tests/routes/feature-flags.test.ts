import { SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryFeatureFlagRepository,
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
    new InMemoryOperatorRepository(),
  )
  const featureFlagRepo = new InMemoryFeatureFlagRepository()
  const app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, featureFlagRepo })
  return { app, featureFlagRepo }
}

type OverridesBody = { data: { overrides: Record<string, boolean> } }

const ADMIN = { sub: 'admin-1', role: 'PLATFORM_ADMIN' } as const
const RENTER = { sub: 'renter-1', role: 'RENTER' } as const

describe('GET /feature-flags (public)', () => {
  test('returns an empty override map with no session', async () => {
    const { app } = makeApp()
    const res = await app.request('/feature-flags')
    expect(res.status).toBe(200)
    const body = (await res.json()) as OverridesBody
    expect(body.data.overrides).toEqual({})
  })

  test('reflects a persisted override without requiring auth', async () => {
    const { app, featureFlagRepo } = makeApp()
    await featureFlagRepo.setOverride('MULTI_CURRENCY', true, 'admin-1')
    const res = await app.request('/feature-flags')
    expect(res.status).toBe(200)
    const body = (await res.json()) as OverridesBody
    expect(body.data.overrides).toEqual({ MULTI_CURRENCY: true })
  })
})

describe('PATCH /admin/feature-flags/:key', () => {
  test('a platform admin upserts an override, visible on the next GET', async () => {
    const { app } = makeApp()
    const res = await app.request('/admin/feature-flags/MULTI_CURRENCY', {
      method: 'PATCH',
      headers: await bearer(ADMIN),
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { key: string; enabled: boolean } }
    expect(body.data).toEqual({ key: 'MULTI_CURRENCY', enabled: true })

    const get = await app.request('/feature-flags')
    const getBody = (await get.json()) as OverridesBody
    expect(getBody.data.overrides).toEqual({ MULTI_CURRENCY: true })
  })

  test('rejects a non-admin caller with 403', async () => {
    const { app } = makeApp()
    const res = await app.request('/admin/feature-flags/MULTI_CURRENCY', {
      method: 'PATCH',
      headers: await bearer(RENTER),
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(403)
  })

  test('rejects an anonymous caller with 401', async () => {
    const { app } = makeApp()
    const res = await app.request('/admin/feature-flags/MULTI_CURRENCY', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(401)
  })

  test('rejects an unknown flag key with 400', async () => {
    const { app } = makeApp()
    const res = await app.request('/admin/feature-flags/NOT_A_REAL_FLAG', {
      method: 'PATCH',
      headers: await bearer(ADMIN),
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects a non-boolean enabled with 400', async () => {
    const { app } = makeApp()
    const res = await app.request('/admin/feature-flags/MULTI_CURRENCY', {
      method: 'PATCH',
      headers: await bearer(ADMIN),
      body: JSON.stringify({ enabled: 'yes' }),
    })
    expect(res.status).toBe(400)
  })
})
