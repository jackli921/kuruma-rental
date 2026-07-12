import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryOperatorApplicationRepository,
  InMemoryOperatorMembershipRepository,
  InMemoryUserRepository,
} from '../../src/repositories/in-memory'
import type { User } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

const valid = {
  businessName: 'Osaka Rentals',
  contactName: 'Aiko',
  contactPhone: '+81 90-1234-5678',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20',
  submittedLocale: 'en',
  consent: true,
}

// A RENTER Bearer session for the signed-in applicant. Sign-in-first submit
// derives contactEmail + applicantUserId from THIS token's subject, never the body.
async function renterBearer(sub: string): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT({ role: 'RENTER', sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

const RENTER: User = {
  id: 'user_7',
  name: 'Aiko',
  email: 'real@x.io',
  phone: null,
  language: 'en',
  country: null,
  role: 'RENTER',
}

function makeApp() {
  setupAuthEnv()
  const operatorApplicationRepo = new InMemoryOperatorApplicationRepository()
  const userStore = new Map<string, User>([[RENTER.id, RENTER]])
  const userRepo = new InMemoryUserRepository(userStore)
  const operatorMembershipRepo = new InMemoryOperatorMembershipRepository()
  const app = createApp({ operatorApplicationRepo, userRepo, operatorMembershipRepo })
  return { app, operatorApplicationRepo, userRepo, operatorMembershipRepo }
}

describe('POST /operator-applications', () => {
  let harness: ReturnType<typeof makeApp>
  beforeEach(() => {
    harness = makeApp()
  })
  const postAuthed = async (body: unknown, sub = RENTER.id) =>
    harness.app.request('/operator-applications', {
      method: 'POST',
      headers: await renterBearer(sub),
      body: JSON.stringify(body),
    })

  test('requires authentication (401 without a session)', async () => {
    const res = await harness.app.request('/operator-applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })
    expect(res.status).toBe(401)
  })

  test('201 persists a pending application', async () => {
    const res = await postAuthed(valid)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, data: { status: 'PENDING' } })
  })

  test('400 on invalid body (missing consent)', async () => {
    const res = await postAuthed({ ...valid, consent: false })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false })
  })

  test('derives contactEmail + applicantUserId from the session, not the request body', async () => {
    // A body-supplied contactEmail must be ignored entirely — the stored row
    // carries the authenticated account's real email + id.
    const res = await postAuthed({ ...valid, contactEmail: 'attacker@evil.io' })
    expect(res.status).toBe(201)
    const [stored] = await harness.operatorApplicationRepo.list({ limit: 100, offset: 0 })
    expect(stored).toMatchObject({ contactEmail: 'real@x.io', applicantUserId: 'user_7' })
  })

  test('honeypot filled → silent 201, but nothing is persisted', async () => {
    const res = await postAuthed({ ...valid, honeypot: 'i-am-a-bot' })
    // Indistinguishable from a real success so the bot learns nothing.
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ success: true, data: { status: 'PENDING' } })
    // The trap persists nothing: a real human can still apply.
    expect(await harness.operatorApplicationRepo.list({ limit: 100, offset: 0 })).toHaveLength(0)
  })

  test('duplicate live email → 409', async () => {
    await postAuthed(valid)
    const res = await postAuthed(valid)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ success: false })
  })

  test('409s when the caller already owns/staffs an operator', async () => {
    await harness.operatorMembershipRepo.create({
      userId: RENTER.id,
      operatorId: 'op_existing',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    const res = await postAuthed(valid)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ success: false })
  })
})

describe('GET /operator-applications/me', () => {
  let harness: ReturnType<typeof makeApp>
  beforeEach(() => {
    harness = makeApp()
  })
  const postAuthed = async (body: unknown, sub = RENTER.id) =>
    harness.app.request('/operator-applications', {
      method: 'POST',
      headers: await renterBearer(sub),
      body: JSON.stringify(body),
    })
  const getAuthed = async (sub = RENTER.id) =>
    harness.app.request('/operator-applications/me', {
      method: 'GET',
      headers: await renterBearer(sub),
    })

  test('200 returns the caller own application', async () => {
    await postAuthed(valid, RENTER.id)
    const res = await getAuthed(RENTER.id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      data: { status: 'PENDING', applicantUserId: RENTER.id },
    })
  })

  test('404 when the caller has no application', async () => {
    const res = await getAuthed('user_none')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false })
  })

  test('another user cannot read someone else application (404, no leak)', async () => {
    await postAuthed(valid, RENTER.id)
    const res = await getAuthed('user_other')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false })
  })

  test('requires authentication (401 without a session)', async () => {
    const res = await harness.app.request('/operator-applications/me', { method: 'GET' })
    expect(res.status).toBe(401)
  })
})
