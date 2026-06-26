import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
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
  const consentRepo = new InMemoryConsentRepository()
  const app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, consentRepo })
  return { app, consentRepo }
}

describe('GET /admin/consent/acceptances/:id/evidence', () => {
  let app: ReturnType<typeof makeApp>['app']
  let consentRepo: ReturnType<typeof makeApp>['consentRepo']

  beforeEach(() => {
    const result = makeApp()
    app = result.app
    consentRepo = result.consentRepo
  })

  test('returns the evidence bundle for a PLATFORM_ADMIN (200)', async () => {
    const acceptance = await consentRepo.createAcceptance({
      documentId: 'doc_1',
      consentType: 'RENTER_TOS',
      userId: 'user_1',
      operatorId: null,
      operatorMembershipId: null,
      actorRole: 'RENTER',
      bookingId: null,
      acceptedAt: new Date('2026-01-01T00:00:00Z'),
      context: null,
      ipAddress: '1.2.3.4',
      userAgent: 'test-agent',
      method: 'CLICKWRAP',
      recordSignature: null,
      signingKeyId: null,
      signatureCanonicalVersion: null,
      documentSnapshot: null,
    })

    const res = await app.request(`/admin/consent/acceptances/${acceptance.id}/evidence`, {
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.acceptance.id).toBe(acceptance.id)
    expect(body.data.verification.status).toBeDefined()
  })

  test('rejects a non-admin caller with 403', async () => {
    const res = await app.request('/admin/consent/acceptances/x/evidence', {
      headers: await bearer({ sub: 'renter-1', role: 'RENTER' }),
    })
    expect(res.status).toBe(403)
  })

  test('returns 404 for a valid-but-unknown acceptance id', async () => {
    const res = await app.request(
      '/admin/consent/acceptances/00000000-0000-4000-8000-000000000ace/evidence',
      {
        headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      },
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 for a malformed (non-uuid) acceptance id (L5)', async () => {
    const res = await app.request('/admin/consent/acceptances/nope/evidence', {
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('id must be a valid uuid')
  })
})
