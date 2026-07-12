import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
import { createOperatorTermsRoutes } from '../../src/routes/operator-terms'
import { OperatorTermsService } from '../../src/services/operator-terms'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'
const draft = { en: { title: 'Terms', body: 'You agree.', acceptanceLabel: 'I agree' } }

function mountFor(
  repo: InMemoryConsentRepository,
  role: UserRole,
  operatorId?: string,
  isOperatorTermsEnabled: () => Promise<boolean> = async () => true,
) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route(
    '/',
    createOperatorTermsRoutes(
      new OperatorTermsService(repo),
      testResolveWriteOperatorId(),
      isOperatorTermsEnabled,
    ),
  )
  return app
}

// Seed a PUBLISHED v1 for `operatorId` (the read endpoint only surfaces published).
async function seedPublished(
  repo: InMemoryConsentRepository,
  operatorId: string,
  input: Parameters<OperatorTermsService['saveDraft']>[1] = draft,
): Promise<void> {
  const svc = new OperatorTermsService(repo)
  await svc.saveDraft(operatorId, input, new Date('2026-06-01T00:00:00Z'))
  await svc.publish(operatorId, 'v1', new Date('2026-06-01T00:00:00Z'))
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('operator-terms authoring routes', () => {
  it('operator saves a draft, publishes it, and lists it', async () => {
    const repo = new InMemoryConsentRepository([])
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)

    const create = await app.request('/operator-terms', post(draft))
    expect(create.status).toBe(201)
    expect((await create.json()).data.version).toBe('v1')

    const pub = await app.request('/operator-terms/v1/publish', { method: 'POST' })
    expect(pub.status).toBe(200)
    expect((await pub.json()).data.status).toBe('PUBLISHED')

    const list = await app.request('/operator-terms')
    expect((await list.json()).data).toHaveLength(1)
  })

  it('an operator cannot see another operator’s terms', async () => {
    const repo = new InMemoryConsentRepository([])
    await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/operator-terms', post(draft))
    const list = await mountFor(repo, 'OPERATOR_OWNER', OP_B).request('/operator-terms')
    expect((await list.json()).data).toHaveLength(0)
  })

  it('a platform admin writing without ?operatorId= is 422', async () => {
    const repo = new InMemoryConsentRepository([])
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/operator-terms', post(draft))
    expect(res.status).toBe(422)
  })

  it('a renter is forbidden from the authoring surface (the FLEET_WRITE gate rejects reads and writes)', async () => {
    const repo = new InMemoryConsentRepository([])
    const renter = mountFor(repo, 'RENTER', OP_A)
    expect((await renter.request('/operator-terms')).status).toBe(403)
    expect((await renter.request('/operator-terms', post(draft))).status).toBe(403)
  })
})

// #877 Slice B: the ONE renter-readable operator-terms route — the modal fetches
// the published doc here. Auth-only (no FLEET_WRITE gate), dark behind the server
// OPERATOR_TERMS flag (404 when off, in lockstep with the booking write path).
describe('GET /operator-terms/published (renter-safe read)', () => {
  const multi = {
    en: { title: 'Terms EN', body: 'Agree EN', acceptanceLabel: 'I agree' },
    ja: { title: '規約', body: '同意します', acceptanceLabel: '同意する' },
  }

  it('returns the published doc for an authed renter in the requested locale', async () => {
    const repo = new InMemoryConsentRepository([])
    await seedPublished(repo, OP_A, multi)
    const res = await mountFor(repo, 'RENTER', OP_A).request(
      `/operator-terms/published?operatorId=${OP_A}&locale=ja`,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      version: 'v1',
      locale: 'ja',
      title: '規約',
      body: '同意します',
      acceptanceLabel: '同意する',
    })
  })

  it('falls back to en when the requested locale is missing', async () => {
    const repo = new InMemoryConsentRepository([])
    await seedPublished(repo, OP_A, { en: multi.en })
    const res = await mountFor(repo, 'RENTER', OP_A).request(
      `/operator-terms/published?operatorId=${OP_A}&locale=zh`,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ version: 'v1', locale: 'en' })
  })

  it('400 when operatorId is missing', async () => {
    const repo = new InMemoryConsentRepository([])
    const res = await mountFor(repo, 'RENTER', OP_A).request('/operator-terms/published?locale=ja')
    expect(res.status).toBe(400)
  })

  it('404 when the operator has no published terms', async () => {
    const repo = new InMemoryConsentRepository([])
    const res = await mountFor(repo, 'RENTER', OP_A).request(
      `/operator-terms/published?operatorId=${OP_A}&locale=en`,
    )
    expect(res.status).toBe(404)
  })

  it('404 (dark) when the OPERATOR_TERMS flag is OFF, even with a published doc', async () => {
    const repo = new InMemoryConsentRepository([])
    await seedPublished(repo, OP_A, multi)
    const res = await mountFor(repo, 'RENTER', OP_A, async () => false).request(
      `/operator-terms/published?operatorId=${OP_A}&locale=ja`,
    )
    expect(res.status).toBe(404)
  })
})
