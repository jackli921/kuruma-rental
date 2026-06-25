import { SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
import type { ConsentDocument } from '../../src/stores'
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
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const consentRepo = new InMemoryConsentRepository([
    doc(),
    doc({ id: 'doc_priv_v1_en', type: 'PRIVACY_POLICY', title: 'Privacy', body: 'Privacy body' }),
  ])
  const app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, consentRepo })
  return { app, consentRepo }
}

const renter = () => bearer({ sub: 'user_1', role: 'RENTER' })

describe('GET /consent/status', () => {
  test('lists the documents a renter still owes, in required order', async () => {
    const { app } = makeApp()
    const res = await app.request('/consent/status', { headers: await renter() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.map((p: { type: string }) => p.type)).toEqual(['RENTER_TOS', 'PRIVACY_POLICY'])
    expect(body.data.map((p: { document: { id: string } }) => p.document.id)).toEqual([
      'doc_tos_v1_en',
      'doc_priv_v1_en',
    ])
  })

  test('401 without a session', async () => {
    const { app } = makeApp()
    const res = await app.request('/consent/status')
    expect(res.status).toBe(401)
  })
})

describe('POST /consent/accept', () => {
  test('records an acceptance and clears it from the pending list', async () => {
    const { app } = makeApp()
    const headers = await renter()
    const accept = await app.request('/consent/accept', {
      method: 'POST',
      headers,
      body: JSON.stringify({ documentId: 'doc_tos_v1_en' }),
    })
    expect(accept.status).toBe(200)
    const acceptBody = await accept.json()
    expect(acceptBody.data.consentType).toBe('RENTER_TOS')
    expect(acceptBody.data.userId).toBe('user_1')

    const status = await app.request('/consent/status', { headers })
    const statusBody = await status.json()
    expect(statusBody.data.map((p: { type: string }) => p.type)).toEqual(['PRIVACY_POLICY'])
  })

  test('404 for an unknown document', async () => {
    const { app } = makeApp()
    const res = await app.request('/consent/accept', {
      method: 'POST',
      headers: await renter(),
      body: JSON.stringify({ documentId: 'nope' }),
    })
    expect(res.status).toBe(404)
  })

  test('400 when documentId is missing', async () => {
    const { app } = makeApp()
    const res = await app.request('/consent/accept', {
      method: 'POST',
      headers: await renter(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
