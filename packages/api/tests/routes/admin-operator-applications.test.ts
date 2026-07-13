import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryOperatorApplicationRepository,
  InMemoryOperatorMembershipRepository,
  InMemoryOperatorRepository,
  InMemoryProviderInviteRepository,
  InMemoryUserRepository,
} from '../../src/repositories/in-memory'
import type { OperatorApplication, User } from '../../src/stores'
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

// Sign-in-first (§6.2): approval promotes the application's linked applicant
// account, so a PENDING row must carry `applicantUserId` and that user must exist
// (setOperatorAccess is a no-op if absent). This harness pre-seeds a linked
// applicant + PENDING application through injected in-memory repos so the approve
// route exercises the real promotion path. The membership/user stores are shared
// with the default runOperatorApproval wiring (same singletons), so the OWNER
// membership + projection writes land where the test can read them.
function makeApprovableApp(overrides: Partial<typeof validApplication> = {}) {
  setupAuthEnv()
  const applicationStore = new Map<string, OperatorApplication>()
  const userStore = new Map<string, User>()
  const operatorApplicationRepo = new InMemoryOperatorApplicationRepository(applicationStore)
  const userRepo = new InMemoryUserRepository(userStore)
  const operatorMembershipRepo = new InMemoryOperatorMembershipRepository()
  const operatorRepo = new InMemoryOperatorRepository()
  const providerInviteRepo = new InMemoryProviderInviteRepository()
  const fields = { ...validApplication, ...overrides }
  return {
    async seed(): Promise<{ id: string; applicantUserId: string }> {
      const applicant = await userRepo.quickCreate({
        name: fields.contactName,
        email: fields.contactEmail,
        phone: fields.contactPhone,
        language: 'en',
      })
      const created = await operatorApplicationRepo.create({
        businessName: fields.businessName,
        contactName: fields.contactName,
        contactEmail: fields.contactEmail,
        contactPhone: fields.contactPhone,
        serviceArea: fields.serviceArea,
        estimatedFleetSize: fields.estimatedFleetSize as OperatorApplication['estimatedFleetSize'],
        website: null,
        businessLicenseNumber: null,
        businessType: null,
        message: null,
        submittedLocale: fields.submittedLocale,
        applicantUserId: applicant.id,
      })
      return { id: created.id, applicantUserId: applicant.id }
    },
    app: createApp({
      operatorApplicationRepo,
      userRepo,
      operatorMembershipRepo,
      operatorRepo,
      providerInviteRepo,
    }),
    operatorApplicationRepo,
    userRepo,
    operatorMembershipRepo,
    operatorRepo,
    providerInviteRepo,
  }
}

// Sign-in-first (#877): POST /operator-applications now requires a session and
// derives the email server-side, so these admin-queue tests seed PENDING rows
// straight through the repo (the submit auth path is covered in the dedicated
// operator-applications route test). The contactEmail override still distinguishes
// rows for the list/order/filter assertions.
async function seedApplication(
  harness: ReturnType<typeof makeApp>,
  overrides: Partial<typeof validApplication> & { applicantUserId?: string | null } = {},
): Promise<{ id: string; status: string }> {
  const { applicantUserId, ...rest } = overrides
  const fields = { ...validApplication, ...rest }
  const created = await harness.operatorApplicationRepo.create({
    businessName: fields.businessName,
    contactName: fields.contactName,
    contactEmail: fields.contactEmail,
    contactPhone: fields.contactPhone,
    serviceArea: fields.serviceArea,
    estimatedFleetSize: fields.estimatedFleetSize as OperatorApplication['estimatedFleetSize'],
    website: null,
    businessLicenseNumber: null,
    businessType: null,
    message: null,
    submittedLocale: fields.submittedLocale,
    // Sign-in-first rows always carry an applicant; pass `applicantUserId: null` to
    // seed a legacy/anonymous row for the manual-invite-refusal path.
    applicantUserId: applicantUserId === undefined ? crypto.randomUUID() : applicantUserId,
  })
  return { id: created.id, status: created.status }
}

// Seeds two applications with distinct createdAt (fake timers) so newest-first
// ordering is deterministic — same-ms stamps otherwise fall back to the random
// UUID tie-break (mirrors the in-memory repo's own list unit test).
async function seedFirstThenSecond(
  harness: ReturnType<typeof makeApp>,
): Promise<{ first: { id: string }; second: { id: string } }> {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2024, 0, 1, 0, 0, 0))
  const first = await seedApplication(harness)
  vi.setSystemTime(new Date(2024, 0, 1, 0, 0, 1))
  const second = await seedApplication(harness, {
    contactEmail: 'second@example.com',
    businessName: 'Second Rentals',
  })
  vi.useRealTimers()
  return { first, second }
}

describe('GET /admin/operator-applications', () => {
  let harness: ReturnType<typeof makeApp>

  beforeEach(() => {
    harness = makeApp()
  })

  test('PLATFORM_ADMIN with ?status=PENDING sees all PENDING apps (newest-first)', async () => {
    const { first, second } = await seedFirstThenSecond(harness)

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
    await seedApplication(harness)
    await seedApplication(harness, { contactEmail: 'other@example.com' })

    const res = await harness.app.request('/admin/operator-applications', {
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: unknown[] }
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
  })

  test('?status filter excludes non-matching rows', async () => {
    const toReject = await seedApplication(harness)
    const staysPending = await seedApplication(harness, {
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
    const { first, second } = await seedFirstThenSecond(harness)

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
    const { id } = await seedApplication(harness)

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
    const { id } = await seedApplication(harness)

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
    const { id } = await seedApplication(harness)
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
    const { id } = await seedApplication(harness)

    const res = await harness.app.request(`/admin/operator-applications/${id}/reject`, {
      method: 'POST',
      headers: await bearer(ADMIN),
      body: JSON.stringify({ rejectionReason: '' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /admin/operator-applications/:id/approve', () => {
  test('PLATFORM_ADMIN approves a linked PENDING application (200) → promotes the applicant, returns {operatorId, operatorSlug}', async () => {
    const harness = makeApprovableApp()
    const { id, applicantUserId } = await harness.seed()

    const res = await harness.app.request(`/admin/operator-applications/${id}/approve`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: { operatorId: string; operatorSlug: string }
    }
    expect(body.success).toBe(true)
    const { data } = body
    expect(data.operatorId.length).toBeGreaterThan(0)
    expect(data.operatorSlug).toBe('osaka-rentals')
    // Sign-in-first: no invite link is issued on the promotion path.
    expect(data).not.toHaveProperty('inviteUrl')
    expect(data).not.toHaveProperty('expiresAt')

    // The applicant's own account is now the OPERATOR_OWNER of the new operator.
    const membership = await harness.operatorMembershipRepo.findActiveByUserId(applicantUserId)
    expect(membership).toMatchObject({
      operatorId: data.operatorId,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    // And the application is claimed + linked to the operator.
    const reloaded = await harness.operatorApplicationRepo.findById(id)
    expect(reloaded).toMatchObject({ status: 'APPROVED', operatorId: data.operatorId })
  })

  test('second approve on the same id → 409 (already reviewed)', async () => {
    const harness = makeApprovableApp()
    const { id } = await harness.seed()
    const headers = await bearer(ADMIN)

    const approve = () =>
      harness.app.request(`/admin/operator-applications/${id}/approve`, {
        method: 'POST',
        headers,
      })

    expect((await approve()).status).toBe(200)
    expect((await approve()).status).toBe(409)
  })

  test('approving a legacy application with no linked account → 409 (use the manual invite)', async () => {
    // A legacy/anonymous row predates sign-in-first submit and carries no
    // applicantUserId, so approval refuses it and directs the admin to the manual invite.
    const harness = makeApp()
    const { id } = await seedApplication(harness, { applicantUserId: null })

    const res = await harness.app.request(`/admin/operator-applications/${id}/approve`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(409)
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
    const { id } = await seedApplication(harness)

    const res = await harness.app.request(`/admin/operator-applications/${id}/approve`, {
      method: 'POST',
      headers: await bearer({ sub: 'u1', role: 'RENTER' }),
    })
    expect(res.status).toBe(403)
  })

  test('C1 — approving a linked email that already has a live pending invite → 409', async () => {
    const harness = makeApprovableApp()
    const { id } = await harness.seed()
    // The same email already holds a live PENDING invite at another operator.
    await harness.providerInviteRepo.create({
      email: validApplication.contactEmail,
      operatorId: 'op-existing',
      role: 'OPERATOR_OWNER',
      tokenHash: 'deadbeef'.repeat(8),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: 'seed-admin',
      acceptedByUserId: null,
    })

    const res = await harness.app.request(`/admin/operator-applications/${id}/approve`, {
      method: 'POST',
      headers: await bearer(ADMIN),
    })
    expect(res.status).toBe(409)
  })
})
