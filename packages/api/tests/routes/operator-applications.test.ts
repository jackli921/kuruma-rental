import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryOperatorApplicationRepository } from '../../src/repositories/in-memory'
import { setupAuthEnv } from '../helpers/auth'

const valid = {
  businessName: 'Osaka Rentals',
  contactName: 'Aiko',
  contactEmail: 'aiko@example.com',
  contactPhone: '+81 90-1234-5678',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20',
  submittedLocale: 'en',
  consent: true,
}

function makeApp() {
  setupAuthEnv()
  const operatorApplicationRepo = new InMemoryOperatorApplicationRepository()
  const app = createApp({ operatorApplicationRepo })
  return { app, operatorApplicationRepo }
}

describe('POST /operator-applications', () => {
  let app: ReturnType<typeof makeApp>['app']
  beforeEach(() => {
    ;({ app } = makeApp())
  })
  const post = (body: unknown) =>
    app.request('/operator-applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  test('201 persists a pending application', async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, data: { status: 'PENDING' } })
  })
  test('400 on invalid body (missing consent)', async () => {
    const res = await post({ ...valid, consent: false })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false })
  })
  test('honeypot filled → silent 201, but nothing is persisted', async () => {
    const { app, operatorApplicationRepo } = makeApp()
    const res = await app.request('/operator-applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...valid, honeypot: 'i-am-a-bot' }),
    })
    // Indistinguishable from a real success so the bot learns nothing.
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ success: true, data: { status: 'PENDING' } })
    // The trap persists nothing: a real human can still apply with that email.
    expect(await operatorApplicationRepo.list({ limit: 100, offset: 0 })).toHaveLength(0)
  })
  test('duplicate live email → 409', async () => {
    await post(valid)
    const res = await post(valid)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ success: false })
  })
})
