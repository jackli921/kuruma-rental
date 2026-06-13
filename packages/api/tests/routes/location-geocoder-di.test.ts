import { SignJWT } from 'jose'
import { describe, expect, test, vi } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

// Provider-independence proof (#531): the composition root (index.ts) is the
// only place that picks a Geocoder. Inject a fake via createApp's override seam
// and an address-only POST /locations must come back GEOCODED with the fake's
// coords — so swapping Nominatim → Google/Mapbox is a one-line change here, with
// no edit to the service, route, schema, or component. The service depends only
// on the Geocoder interface (see services/location.test.ts).
async function ownerHeaders(operatorId: string): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT({ sub: 'owner', role: 'OPERATOR_OWNER', operatorId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

describe('Geocoder DI — provider swap touches only index.ts (#531)', () => {
  test('an injected Geocoder drives geocode-on-save: address-only create → GEOCODED coords', async () => {
    setupAuthEnv()
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
    const geocode = vi.fn(async () => ({ lat: 34.6937, lng: 135.5023 }))
    const app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, geocoder: { geocode } })

    const res = await app.request('/locations', {
      method: 'POST',
      headers: await ownerHeaders('op_a'),
      body: JSON.stringify({ name: 'Namba HQ', address: '1-2-3 Namba, Osaka' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toMatchObject({
      coordinateSource: 'GEOCODED',
      latitude: 34.6937,
      longitude: 135.5023,
    })
    expect(geocode).toHaveBeenCalledWith('1-2-3 Namba, Osaka')
  })

  test('an over-limit GEOCODE_LIMITER skips the lookup: location still saves, with no coords (#574)', async () => {
    setupAuthEnv()
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
    const geocode = vi.fn(async () => ({ lat: 34.6937, lng: 135.5023 }))
    // Native CF binding shape (limit({ key }) → { success }); index.ts adapts it.
    const geocodeLimiter = { limit: vi.fn(async () => ({ success: false })) }
    const app = createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      geocoder: { geocode },
      geocodeLimiter,
    })

    const res = await app.request('/locations', {
      method: 'POST',
      headers: await ownerHeaders('op_a'),
      body: JSON.stringify({ name: 'Namba HQ', address: '1-2-3 Namba, Osaka' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toMatchObject({
      coordinateSource: null,
      latitude: null,
      longitude: null,
    })
    expect(geocode).not.toHaveBeenCalled()
    expect(geocodeLimiter.limit).toHaveBeenCalledWith({ key: 'geocode:global' })
  })
})
