import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryOperatorApplicationRepository,
  InMemoryProviderInviteRepository,
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

const ADMIN = { sub: 'admin-1', role: 'PLATFORM_ADMIN' } as const

const validApplication = {
  businessName: 'Osaka Rentals',
  contactName: 'Aiko',
  contactEmail: 'aiko@example.com',
  contactPhone: '+81 90-1234-5678',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20',
  submittedLocale: 'en',
  consent: true,
}

function makeApp(extra: Parameters<typeof createApp>[0] = {}) {
  setupAuthEnv()
  const operatorApplicationRepo = new InMemoryOperatorApplicationRepository()
  const app = createApp({ operatorApplicationRepo, ...extra })
  return { app, operatorApplicationRepo }
}

async function seedApplication(
  app: ReturnType<typeof makeApp>['app'],
  overrides: Partial<typeof validApplication> = {},
): Promise<{ id: string; status: string }> {
  const res = await app.request('/operator-applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validApplication, ...overrides }),
  })
  const body = (await res.json()) as { data: { id: string; status: string } }
  return body.data
}

describe('GET /admin/operator-applications', () => {
  let harness: ReturnType<typeof makeApp>

  beforeEach(() => {
    harness = makeApp()
  })

  test('PLATFORM_ADMIN with ?status=PENDING sees all PENDING apps (newest-first)', async () => {
    const first = await seedApplication(harness.app)
    const second = await seedApplication(harness.app, {
      contactEmail: 'second@example.com',
      businessName: 'Second Rentals',
    })

    const res = await harness.app.request('/admin/operator-applications?status=PENDING', {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: Array<{
        id: string
        businessName: string
        status: string
        contactEmail: string
      }>
    }
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    // newest-first: second seeded after first
    expect(body.data[0]?.id).toBe(second.id)
    expect(body.data[1]?.id).toBe(first.id)
    // each row has business fields + status
    for (const row of body.data) {
      expect(row.status).toBe('PENDING')
      expect(typeof row.businessName).toBe('string')
      expect(typeof row.contactEmail).toBe('string')
    }
  })

  test('PLATFORM_ADMIN with no status filter returns all applications', async () => {
    await seedApplication(harness.app)
    await seedApplication(harness.app, { contactEmail: 'other@example.com' })

    const res = await harness.app.request('/admin/operator-applications', {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: unknown[] }
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
  })

  test('?status filter excludes non-matching rows', async () => {
    const toReject = await seedApplication(harness.app)
    const staysPending = await seedApplication(harness.app, {
      contactEmail: 'pending@example.com',
      businessName: 'Pending Rentals',
    })
    // Reject one so the two rows have different statuses.
    const rejectRes = await harness.app.request(
      `/admin/operator-applications/${toReject.id}/reject`,
      {
        method: 'POST',
        headers: await bearer(ADMIN),
        body: JSON.stringify({ rejectionReason: 'not eligible' }),
      },
    )
    expect(rejectRes.status).toBe(200)

    const pendingRes = await harness.app.request('/admin/operator-applications?status=PENDING', {
      headers: await bearer(ADMIN),
    })
    const pending = (await pendingRes.json()) as { data: Array<{ id: string }> }
    expect(pending.data).toHaveLength(1)
    expect(pending.data[0]?.id).toBe(staysPending.id)

    const rejectedRes = await harness.app.request('/admin/operator-applications?status=REJECTED', {
      headers: await bearer(ADMIN),
    })
    const rejected = (await rejectedRes.json()) as { data: Array<{ id: string }> }
    expect(rejected.data).toHaveLength(1)
    expect(rejected.data[0]?.id).toBe(toReject.id)
  })

  test('non-admin (RENTER) is forbidden (403)', async () => {
    const res = await harness.app.request('/admin/operator-applications', {
      headers: await bearer({ sub: 'u1', role: 'RENTER' }),
    })
    expect(res.status).toBe(403)
  })

  test('invalid status value returns 400', async () => {
    const res = await harness.app.request('/admin/operator-applications?status=BOGUS', {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(400)
  })

  test('?limit=0 is rejected (400) — the page is always capped, never unbounded', async () => {
    const res = await harness.app.request('/admin/operator-applications?limit=0', {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(400)
  })

  test('?limit above the 100 max is rejected (400)', async () => {
    const res = await harness.app.request('/admin/operator-applications?limit=101', {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(400)
  })

  test('?limit caps the returned page and ?offset walks to the next one', async () => {
    const first = await seedApplication(harness.app)
    const second = await seedApplication(harness.app, {
      contactEmail: 'second@example.com',
      businessName: 'Second Rentals',
    })

    const capped = await harness.app.request('/admin/operator-applications?limit=1', {
      headers: await bearer(ADMIN),
    })
    const cappedBody = (await capped.json()) as { data: Array<{ id: string }> }
    expect(cappedBody.data).toHaveLength(1)
    // Newest-first: the second seed is the head of the queue.
    expect(cappedBody.data[0]?.id).toBe(second.id)

    const nextPage = await harness.app.request('/admin/operator-applications?limit=1&offset=1', {
      headers: await bearer(ADMIN),
    })
    const nextBody = (await nextPage.json()) as { data: Array<{ id: string }> }
    expect(nextBody.data).toHaveLength(1)
    expect(nextBody.data[0]?.id).toBe(first.id)
  })
})

describe('POST /admin/operator-applications/:id/reject', () => {
  let harness: ReturnType<typeof makeApp>

  beforeEach(() => {
    harness = makeApp()
  })

  test('PLATFORM_ADMIN rejects a PENDING application (200)', async () => {
    const { id } = await seedApplication(harness.app)

    const res = await harness.app.request(`/admin/operator-applications/${id}/reject`, {
      method: 'POST',
      headers: await bearer(ADMIN),
      body: JSON.stringify({ rejectionReason: 'not eligible' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: {
        id: string
        status: string
        rejectionReason: string | null
        reviewedByUserId: string | null
      }
    }
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('REJECTED')
    expect(body.data.rejectionReason).toBe('not eligible')
    expect(body.data.reviewedByUserId).toBe('admin-1')
  })

  test('non-admin (RENTER) cannot reject (403)', async () => {
    const { id } = await seedApplication(harness.app)

    const res = await harness.app.request(`/admin/operator-applications/${id}/reject`, {
      method: 'POST',
      headers: await bearer({ sub: 'u1', role: 'RENTER' }),
      body: JSON.stringify({ rejectionReason: 'not eligible' }),
    })
    expect(res.status).toBe(403)
  })

  test('unknown application id → 404', async () => {
    const randomId = '00000000-0000-0000-0000-000000000000'
    const res = await harness.app.request(`/admin/operator-applications/${randomId}/reject`, {
      method: 'POST',
      headers: await bearer(ADMIN),
      body: JSON.stringify({ rejectionReason: 'not eligible' }),
    })
    expect(res.status).toBe(404)
  })

  test('rejecting an already-rejected (non-PENDING) application → 404', async () => {
    const { id } = await seedApplication(harness.app)
    const headers = await bearer(ADMIN)
    const body = JSON.stringify({ rejectionReason: 'not eligible' })
    const reject = () =>
      harness.app.request(`/admin/operator-applications/${id}/reject`, {
        method: 'POST',
        headers,
        body,
      })

    expect((await reject()).status).toBe(200)
    // The row is no longer PENDING, so a second reject finds nothing to act on → 404.
    expect((await reject()).status).toBe(404)
  })

  test('empty rejectionReason → 400 (schema min(1))', async () => {
    const { id } = await seedApplication(harness.app)

    const res = await harness.app.request(`/admin/operator-applications/${id}/reject`, {
      method: 'POST',
      headers: await bearer(ADMIN),
      body: JSON.stringify({ rejectionReason: '' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /admin/operator-applications/:id/approve', () => {
  test('PLATFORM_ADMIN approves a PENDING application (200) and gets {operatorId, inviteUrl, expiresAt}', async () => {
    const harness = makeApp()
    const { id } = await seedApplication(harness.app)

    const res = await harness.app.request(`/admin/operator-applications/${id}/approve`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: { operatorId: string; inviteUrl: string; expiresAt: string }
    }
    expect(body.success).toBe(true)
    const { data } = body
    expect(typeof data.operatorId).toBe('string')
    expect(data.operatorId.length).toBeGreaterThan(0)
    // WEB_ORIGIN is unset in tests so the base is '' → path-only URL
    expect(data.inviteUrl).toMatch(/\/provider\/invite\//)
    expect(typeof data.expiresAt).toBe('string')
    // The route projects to exactly 3 fields — the internal operatorSlug is not leaked.
    expect(data).not.toHaveProperty('operatorSlug')
  })

  test('second approve on the same id → 409 (already reviewed)', async () => {
    const harness = makeApp()
    const { id } = await seedApplication(harness.app)
    const headers = await bearer(ADMIN)

    const approve = () =>
      harness.app.request(`/admin/operator-applications/${id}/approve`, {
        method: 'POST',
        headers,
      })

    expect((await approve()).status).toBe(200)
    expect((await approve()).status).toBe(409)
  })

  test('unknown application id → 404 (distinct from the 409 already-reviewed path)', async () => {
    const harness = makeApp()
    const randomId = '00000000-0000-0000-0000-000000000000'
    const res = await harness.app.request(`/admin/operator-applications/${randomId}/approve`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(404)
  })

  test('malformed (non-uuid) id → 400', async () => {
    const harness = makeApp()
    const res = await harness.app.request('/admin/operator-applications/not-a-uuid/approve', {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(400)
  })

  test('non-admin (RENTER) cannot approve (403)', async () => {
    const harness = makeApp()
    const { id } = await seedApplication(harness.app)

    const res = await harness.app.request(`/admin/operator-applications/${id}/approve`, {
      method: 'POST',
      headers: await bearer({ sub: 'u1', role: 'RENTER' }),
    })
    expect(res.status).toBe(403)
  })

  test('C1 — approving an email that already has a live pending invite → 409', async () => {
    const providerInviteRepo = new InMemoryProviderInviteRepository()
    await providerInviteRepo.create({
      email: validApplication.contactEmail,
      operatorId: 'op-existing',
      role: 'OPERATOR_OWNER',
      tokenHash: 'deadbeef'.repeat(8),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: 'seed-admin',
      acceptedByUserId: null,
    })
    const harness = makeApp({ providerInviteRepo })
    const { id } = await seedApplication(harness.app)

    const res = await harness.app.request(`/admin/operator-applications/${id}/approve`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(409)
  })
})
