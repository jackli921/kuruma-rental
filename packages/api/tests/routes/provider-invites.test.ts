import { createHash } from 'node:crypto'
import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryProviderInviteRepository,
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
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const providerInviteRepo = new InMemoryProviderInviteRepository()
  const app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, providerInviteRepo })
  return { app, providerInviteRepo }
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const validBody = { email: 'Pilot@Operator.example', operatorId: 'op_1', role: 'OPERATOR_OWNER' }

describe('POST /admin/provider-invites', () => {
  let app: ReturnType<typeof makeApp>['app']
  let providerInviteRepo: ReturnType<typeof makeApp>['providerInviteRepo']

  beforeEach(() => {
    ;({ app, providerInviteRepo } = makeApp())
  })

  test('PLATFORM_ADMIN mints an invite, returning a one-time token (201)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify(validBody),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(body.data.inviteUrl).toMatch(
      new RegExp(`/provider/invite/${body.data.token.replace(/[-]/g, '\\$&')}$`),
    )
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('persists only the token hash, lowercased email, and PENDING status', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify(validBody),
    })
    const { token } = (await res.json()).data

    // Plaintext token is never stored — only its sha256 hash is queryable.
    expect(await providerInviteRepo.findByTokenHash(token)).toBeUndefined()
    const stored = await providerInviteRepo.findByTokenHash(sha256Hex(token))
    expect(stored).toMatchObject({
      email: 'pilot@operator.example',
      operatorId: 'op_1',
      role: 'OPERATOR_OWNER',
      status: 'PENDING',
      invitedByUserId: 'admin-1',
      acceptedByUserId: null,
    })
  })

  test('OPERATOR_OWNER cannot mint invites (403)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'owner-1', role: 'OPERATOR_OWNER', operatorId: 'op_1' }),
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(403)
  })

  test('RENTER cannot mint invites (403)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'renter-1', role: 'RENTER' }),
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(403)
  })

  test('rejects an unauthenticated request (401)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(401)
  })

  test('rejects a malformed body (400)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({ email: 'not-an-email', operatorId: 'op_1', role: 'OPERATOR_OWNER' }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects an unknown operator role (400)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({ email: 'pilot@operator.example', operatorId: 'op_1', role: 'WIZARD' }),
    })
    expect(res.status).toBe(400)
  })
})
