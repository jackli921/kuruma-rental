import { SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
import type { ConsentDocument } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

// #877 Phase 2 slice 2b: the consent ledger gates renter self-serve booking
// creation. A renter must be current on RENTER_TOS + PRIVACY_POLICY or POST
// /bookings is rejected 403 CONSENT_REQUIRED before any vehicle is touched.
// Staff/operator/partner callers book on behalf and are exempt (only the gate
// is exercised here — the downstream create fails on the absent vehicle, which
// is fine: the assertion is purely about whether the gate fired).

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

function doc(over: Partial<ConsentDocument> = {}): ConsentDocument {
  return {
    id: 'doc_tos_v1_en',
    type: 'RENTER_TOS',
    version: '1.0',
    locale: 'en',
    title: 'Terms',
    body: 'Terms body',
    acceptanceLabel: 'I accept',
    contentHash: 'a'.repeat(64),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
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
  const consentRepo = new InMemoryConsentRepository([
    doc(),
    doc({ id: 'doc_priv_v1_en', type: 'PRIVACY_POLICY', title: 'Privacy', body: 'Privacy body' }),
  ])
  return createApp({ vehicleRepo, bookingRepo, availabilityRepo, consentRepo })
}

const VEHICLE_ID = '11111111-1111-4111-8111-111111111111'
const LOCATION_ID = '22222222-2222-4222-8222-222222222222'

function bookingBody(over: Record<string, unknown> = {}) {
  return {
    requestedVehicleId: VEHICLE_ID,
    pickupLocationId: LOCATION_ID,
    dropoffLocationId: LOCATION_ID,
    startAt: '2027-03-01T10:00:00Z',
    endAt: '2027-03-01T14:00:00Z',
    source: 'DIRECT',
    disclaimerAccepted: true,
    ...over,
  }
}

const renter = () => bearer({ sub: 'user_1', role: 'RENTER' })

describe('POST /bookings — consent ledger gate (#877 2b)', () => {
  test('blocks a renter who has not accepted ToS + privacy (403 CONSENT_REQUIRED + missing)', async () => {
    const app = makeApp()
    const res = await app.request('/bookings', {
      method: 'POST',
      headers: await renter(),
      body: JSON.stringify(bookingBody()),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('CONSENT_REQUIRED')
    expect(body.missing).toEqual(['RENTER_TOS', 'PRIVACY_POLICY'])
  })

  test('lets a renter through once current on ToS + privacy (gate does not fire)', async () => {
    const app = makeApp()
    const headers = await renter()
    for (const documentId of ['doc_tos_v1_en', 'doc_priv_v1_en']) {
      const accept = await app.request('/consent/accept', {
        method: 'POST',
        headers,
        body: JSON.stringify({ documentId }),
      })
      expect(accept.status).toBe(200)
    }
    const res = await app.request('/bookings', {
      method: 'POST',
      headers,
      body: JSON.stringify(bookingBody()),
    })
    expect(res.status).not.toBe(403)
    const body = await res.json()
    expect(body.missing).toBeUndefined()
  })

  test('exempts a non-renter booker (staff/operator/partner) from the ledger gate', async () => {
    const app = makeApp()
    const res = await app.request('/bookings', {
      method: 'POST',
      headers: await bearer({ sub: 'admin_1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify(bookingBody()),
    })
    const body = await res.json()
    expect(body.missing).toBeUndefined()
  })
})
